javascript:(function main() {

    /* --- 防止重复执行 --- */
    if (window.visualDOMEdit && window.visualDOMEdit.isActive) {
        window.visualDOMEdit.destroy();
        return;
    }

    const VDE = {
        /* --- 状态管理 --- */
        state: {
            isActive: false,
            hoveredElement: null,
            selectedElement: null,
            originalStyles: null,
            currentAction: null,
            lastMousePosition: { x: 0, y: 0 },
            startX: 0, startY: 0, startLeft: 0, startTop: 0, startWidth: 0, startHeight: 0,
            resizeDirection: null,
        },

        /* --- UI 元素 --- */
        ui: {
            controlBox: null, handles: [], styleTag: null,
            selectorIndicator: null, indicatorTag: null,
            doneBtn: null, cancelBtn: null,
            btnZUp: null, btnZDown: null, /* --- 新增：z-index按钮 --- */
        },

        /* --- 启动脚本 --- */
        init: function() {
            if (this.state.isActive) return;
            console.log("Visual DOM Editor: Activated.");
            this.injectCSS(); this.createUI();
            document.addEventListener('mousemove', this.handleMouseMove, true);
            document.addEventListener('click', this.handleClick, true);
            document.addEventListener('keydown', this.handleKeyDown, true);
            this.state.isActive = true; window.visualDOMEdit = this;
        },

        /* --- 销毁脚本 --- */
        destroy: function() {
            if (!this.state.isActive) return;
            console.log("Visual DOM Editor: Deactivated.");
            document.removeEventListener('mousemove', this.handleMouseMove, true);
            document.removeEventListener('click', this.handleClick, true);
            document.removeEventListener('keydown', this.handleKeyDown, true);
            document.removeEventListener('mousedown', this.handleMouseDownAction, true);
            document.removeEventListener('mousemove', this.handleMouseMoveAction, true);
            document.removeEventListener('mouseup', this.handleMouseUpAction, true);
            if(this.state.selectedElement) this.revertChanges();
            const uiElements = ['controlBox', 'styleTag', 'selectorIndicator'];
            uiElements.forEach(key => { if (this.ui[key] && this.ui[key].parentNode) this.ui[key].parentNode.removeChild(this.ui[key]); });
            if (this.state.hoveredElement) this.state.hoveredElement.classList.remove('vde-highlight');
            this.state = { isActive: false }; window.visualDOMEdit = null;
        },

        /* --- CSS 注入 --- */
        injectCSS: function() {
            const css = `
                .vde-highlight { outline: 2px dashed #007bff !important; outline-offset: -2px; cursor: pointer; }
                .vde-control-box { position: absolute; border: 2px solid #ff4500; z-index: 99999998; pointer-events: auto; cursor: move; }
                .vde-resize-handle { position: absolute; width: 12px; height: 12px; background: #ff4500; border: 1px solid white; border-radius: 50%; pointer-events: auto !important; transform: translate(-50%, -50%); }
                .vde-handle-nw, .vde-handle-se { cursor: nwse-resize; } .vde-handle-ne, .vde-handle-sw { cursor: nesw-resize; } .vde-handle-n, .vde-handle-s { cursor: ns-resize; } .vde-handle-w, .vde-handle-e { cursor: ew-resize; }
                .vde-selector-indicator { position: absolute; display: flex; align-items: center; background-color: rgba(30, 30, 30, 0.9); color: white; border-radius: 4px; padding: 4px 8px; font-family: sans-serif; font-size: 12px; z-index: 99999999; pointer-events: none; transition: opacity 0.1s ease; opacity: 0; user-select: none; }
                .vde-selector-indicator.visible { opacity: 1; }
                .vde-indicator-btn { cursor: pointer; font-weight: bold; padding: 0 5px; font-size: 16px; pointer-events: auto; }
                .vde-indicator-btn:hover { color: #00aaff; }
                .vde-indicator-tag { margin: 0 8px; font-family: monospace; }
                .vde-indicator-actions, .vde-indicator-z-actions { display: none; margin-left: 8px; border-left: 1px solid #555; padding-left: 8px; }
                .vde-indicator-done-btn { color: #28a745; }
                .vde-indicator-cancel-btn { color: #dc3545; margin-left: 5px;}
                .vde-selector-indicator.editing .vde-indicator-actions, .vde-selector-indicator.editing .vde-indicator-z-actions { display: inline-flex; align-items: center; }
            `;
            this.ui.styleTag = document.createElement('style'); this.ui.styleTag.id = 'vde-styles';
            this.ui.styleTag.innerHTML = css; document.head.appendChild(this.ui.styleTag);
        },

        /* --- UI 创建 --- */
        createUI: function() {
            /* --- 操作框 --- */
            this.ui.controlBox = document.createElement('div'); this.ui.controlBox.className = 'vde-control-box'; this.ui.controlBox.style.display = 'none';
            ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].forEach(dir => {
                const handle = document.createElement('div'); handle.className = `vde-resize-handle vde-handle-${dir}`; handle.dataset.direction = dir; this.ui.controlBox.appendChild(handle);
            });
            document.body.appendChild(this.ui.controlBox);
            /* --- 指示器 --- */
            this.ui.selectorIndicator = document.createElement('div'); this.ui.selectorIndicator.className = 'vde-selector-indicator';
            const btnUp = document.createElement('div'); btnUp.className = 'vde-indicator-btn'; btnUp.innerHTML = '▲'; btnUp.title = '选择父元素 (↑)'; btnUp.addEventListener('click', (e) => { e.stopPropagation(); this.selectParentElement(); });
            this.ui.indicatorTag = document.createElement('span'); this.ui.indicatorTag.className = 'vde-indicator-tag';
            /* --- Z-Index 操作区 --- */
            const zActions = document.createElement('div'); zActions.className = 'vde-indicator-z-actions';
            this.ui.btnZDown = document.createElement('div'); this.ui.btnZDown.className = 'vde-indicator-btn'; this.ui.btnZDown.innerHTML = 'Z▼'; this.ui.btnZDown.title = '降低层级'; this.ui.btnZDown.addEventListener('click', (e) => { e.stopPropagation(); this.adjustZIndex('backward'); });
            this.ui.btnZUp = document.createElement('div'); this.ui.btnZUp.className = 'vde-indicator-btn'; this.ui.btnZUp.innerHTML = 'Z▲'; this.ui.btnZUp.title = '提升层级'; this.ui.btnZUp.addEventListener('click', (e) => { e.stopPropagation(); this.adjustZIndex('forward'); });
            zActions.append(this.ui.btnZDown, this.ui.btnZUp);
            /* --- 完成/取消 操作区 --- */
            const actions = document.createElement('div'); actions.className = 'vde-indicator-actions';
            this.ui.doneBtn = document.createElement('div'); this.ui.doneBtn.className = 'vde-indicator-btn vde-indicator-done-btn'; this.ui.doneBtn.innerHTML = '✓'; this.ui.doneBtn.title = '完成调整'; this.ui.doneBtn.addEventListener('click', (e) => { e.stopPropagation(); this.finalizeSelection(); });
            this.ui.cancelBtn = document.createElement('div'); this.ui.cancelBtn.className = 'vde-indicator-btn vde-indicator-cancel-btn'; this.ui.cancelBtn.innerHTML = '✗'; this.ui.cancelBtn.title = '取消调整'; this.ui.cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); this.cancelSelection(); });
            actions.append(this.ui.doneBtn, this.ui.cancelBtn);
            this.ui.selectorIndicator.append(btnUp, this.ui.indicatorTag, zActions, actions);
            document.body.appendChild(this.ui.selectorIndicator);
        },

        /* --- 核心事件与逻辑 --- */
        handleMouseMove: function(e) {
            this.state.lastMousePosition = { x: e.clientX, y: e.clientY };
            if (this.state.selectedElement) return;
            const target = e.target;
            if (target === this.state.hoveredElement || target.closest('.vde-selector-indicator')) return;
            this.updateHoveredElement(target);
        },
        handleKeyDown: function(e) {
            if (!this.state.hoveredElement && !this.state.selectedElement) return;
            if (e.key === 'ArrowUp') { e.preventDefault(); this.selectParentElement(); }
        },
        handleClick: function(e) {
            if (e.target.closest('.vde-control-box') || e.target.closest('.vde-selector-indicator')) return;
            e.preventDefault(); e.stopPropagation();
            if (this.state.selectedElement) { this.cancelSelection(); }
            else if (this.state.hoveredElement) {
                this.state.selectedElement = this.state.hoveredElement;
                this.state.hoveredElement.classList.remove('vde-highlight');
                this.state.hoveredElement = null;
                this.storeOriginalStyles(this.state.selectedElement);
                this.switchToEditMode();
            }
        },
        selectParentElement: function() {
            const currentEl = this.state.selectedElement || this.state.hoveredElement;
            if (!currentEl) return;
            const newTarget = currentEl.parentElement;
            if (newTarget && newTarget !== document.body && newTarget !== document.documentElement) {
                this.changeSelectionTarget(newTarget);
            }
        },
        changeSelectionTarget: function(newTarget) {
            if (this.state.selectedElement) {
                this.revertChanges();
                this.state.selectedElement = newTarget;
                this.storeOriginalStyles(newTarget);
                this.updateControlBoxPosition(); this.updateIndicator();
            } else if (this.state.hoveredElement) {
                this.updateHoveredElement(newTarget);
            }
        },

        /* --- Z-Index 调整核心逻辑 --- */
        adjustZIndex: function(direction) {
            if (!this.state.selectedElement) return;
            const target = this.state.selectedElement;
            const currentZ = this.getComputedZIndex(target);
            const targetRect = target.getBoundingClientRect();

            let overlappingZIndexes = [];
            document.querySelectorAll('body *').forEach(el => {
                if (el === target || el.closest('.vde-control-box') || el.closest('.vde-selector-indicator')) return;
                const elRect = el.getBoundingClientRect();
                if (!(elRect.right < targetRect.left || elRect.left > targetRect.right || elRect.bottom < targetRect.top || elRect.top > targetRect.bottom)) {
                    overlappingZIndexes.push(this.getComputedZIndex(el));
                }
            });

            let newZ;
            if (direction === 'forward') {
                const higherZIndexes = overlappingZIndexes.filter(z => z > currentZ);
                if (higherZIndexes.length > 0) {
                    newZ = Math.min(...higherZIndexes) + 1;
                } else {
                    newZ = currentZ + 1;
                }
            } else {
                const lowerZIndexes = overlappingZIndexes.filter(z => z < currentZ);
                if (lowerZIndexes.length > 0) {
                    newZ = Math.max(...lowerZIndexes) - 1;
                } else {
                    newZ = currentZ - 1;
                }
            }
            target.style.zIndex = newZ;
        },

        /* --- 模式切换与状态管理 --- */
        switchToEditMode: function() {
            const el = this.state.selectedElement;
            if(getComputedStyle(el).position === 'static') el.style.position = 'relative';
            this.ui.controlBox.addEventListener('mousedown', this.handleMouseDownAction, true);
            this.updateControlBoxPosition(); this.updateIndicator();
            this.ui.controlBox.style.display = 'block';
            this.ui.selectorIndicator.classList.add('editing');
        },
        finalizeSelection: function() { if (!this.state.selectedElement) return; this.exitEditMode(false); },
        cancelSelection: function() { if (!this.state.selectedElement) return; this.exitEditMode(true); },
        exitEditMode: function(shouldRevert) {
            if (shouldRevert) this.revertChanges();
            this.ui.controlBox.removeEventListener('mousedown', this.handleMouseDownAction, true);
            this.state.selectedElement = null; this.state.originalStyles = null;
            this.ui.controlBox.style.display = 'none';
            this.ui.selectorIndicator.classList.remove('editing');
            const elUnderMouse = document.elementFromPoint(this.state.lastMousePosition.x, this.state.lastMousePosition.y);
            this.updateHoveredElement(elUnderMouse);
        },
        storeOriginalStyles: function(element) {
            const style = element.style;
            this.state.originalStyles = {
                position: style.position, top: style.top, left: style.left,
                width: style.width, height: style.height, zIndex: style.zIndex,
            };
        },
        revertChanges: function() {
            if (!this.state.selectedElement || !this.state.originalStyles) return;
            Object.assign(this.state.selectedElement.style, this.state.originalStyles);
        },

        /* --- 拖拽/缩放操作 --- */
        handleMouseDownAction: function(e) {
            e.preventDefault(); e.stopPropagation();
            const rect = this.state.selectedElement.getBoundingClientRect();
            this.state.startX = e.clientX; this.state.startY = e.clientY;
            this.state.startLeft = this.state.selectedElement.offsetLeft; this.state.startTop = this.state.selectedElement.offsetTop;
            this.state.startWidth = rect.width; this.state.startHeight = rect.height;
            this.state.currentAction = e.target.classList.contains('vde-resize-handle') ? 'resizing' : 'dragging';
            if (this.state.currentAction === 'resizing') this.state.resizeDirection = e.target.dataset.direction;
            document.addEventListener('mousemove', this.handleMouseMoveAction, true);
            document.addEventListener('mouseup', this.handleMouseUpAction, true);
        },
        handleMouseMoveAction: function(e) {
            if (!this.state.currentAction) return; e.preventDefault();
            const deltaX = e.clientX - this.state.startX, deltaY = e.clientY - this.state.startY;
            const element = this.state.selectedElement;
            if (this.state.currentAction === 'dragging') {
                element.style.left = `${this.state.startLeft + deltaX}px`; element.style.top = `${this.state.startTop + deltaY}px`;
            } else if (this.state.currentAction === 'resizing') {
                const dir = this.state.resizeDirection;
                if (dir.includes('e')) element.style.width = `${this.state.startWidth + deltaX}px`;
                if (dir.includes('w')) { element.style.width = `${this.state.startWidth - deltaX}px`; element.style.left = `${this.state.startLeft + deltaX}px`; }
                if (dir.includes('s')) element.style.height = `${this.state.startHeight + deltaY}px`;
                if (dir.includes('n')) { element.style.height = `${this.state.startHeight - deltaY}px`; element.style.top = `${this.state.startTop + deltaY}px`; }
            }
            this.updateControlBoxPosition();
        },
        handleMouseUpAction: function(e) {
            e.preventDefault(); this.state.currentAction = null; this.state.resizeDirection = null;
            document.removeEventListener('mousemove', this.handleMouseMoveAction, true);
            document.removeEventListener('mouseup', this.handleMouseUpAction, true);
        },

        /* --- 辅助函数 --- */
        getComputedZIndex: function(element) {
            if (!element) return 0;
            const zIndexStr = window.getComputedStyle(element).zIndex;
            return zIndexStr === 'auto' ? 0 : parseInt(zIndexStr, 10) || 0;
        },
        updateHoveredElement: function(newTarget) {
            if (this.state.hoveredElement) this.state.hoveredElement.classList.remove('vde-highlight');
            this.state.hoveredElement = newTarget;
            if(this.state.hoveredElement) this.state.hoveredElement.classList.add('vde-highlight');
            this.updateIndicator();
        },
        updateIndicator: function() {
            const target = this.state.selectedElement || this.state.hoveredElement;
            if (!target) { this.ui.selectorIndicator.classList.remove('visible'); return; }
            const rect = target.getBoundingClientRect();
            const indicator = this.ui.selectorIndicator;
            const topPos = rect.top + window.pageYOffset - indicator.offsetHeight - 5;
            indicator.style.top = `${Math.max(5, topPos)}px`;
            indicator.style.left = `${rect.left + window.pageXOffset}px`;
            this.ui.indicatorTag.textContent = `${target.tagName.toLowerCase()} (z:${this.getComputedZIndex(target)})`;
            indicator.classList.add('visible');
        },
        updateControlBoxPosition: function() {
            if (!this.state.selectedElement) return;
            const rect = this.state.selectedElement.getBoundingClientRect();
            const box = this.ui.controlBox;
            box.style.left = `${rect.left + window.pageXOffset}px`; box.style.top = `${rect.top + window.pageYOffset}px`;
            box.style.width = `${rect.width}px`; box.style.height = `${rect.height}px`;
            this.updateIndicator();
        }
    };

    /* --- 绑定 this 上下文 --- */
    for (let key in VDE) { if (typeof VDE[key] === 'function') { VDE[key] = VDE[key].bind(VDE); } }
    /* --- 启动 --- */
    VDE.init();
})();