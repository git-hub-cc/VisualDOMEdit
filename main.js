javascript:(function main() {

    const VDE_STYLE_ID = 'vde-styles';
    const VDE_CONTROL_BOX_ID = 'vde-control-box';
    const VDE_INDICATOR_ID = 'vde-selector-indicator';

    /* --- 新的关闭逻辑：通过检测UI元素ID来判断是否重复执行 --- */
    if (document.getElementById(VDE_CONTROL_BOX_ID)) {
        if (window.visualDOMEdit && typeof window.visualDOMEdit.destroy === 'function') {
            window.visualDOMEdit.destroy();
        } else {
            console.warn("Visual DOM Editor: Forcing cleanup via manual removal. Some event listeners may remain if the instance was corrupted.");
            const idsToRemove = [VDE_STYLE_ID, VDE_CONTROL_BOX_ID, VDE_INDICATOR_ID];
            idsToRemove.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.remove();
            });
            document.body.classList.remove('vde-is-active');
        }
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
            selectionHistory: [],
        },

        /* --- UI 元素 --- */
        ui: {
            controlBox: null, handles: [], styleTag: null,
            selectorIndicator: null, indicatorTag: null,
            doneBtn: null, cancelBtn: null,
            btnUp: null, btnDown: null,
            btnZUp: null, btnZDown: null,
        },

        /* --- Trusted Types 策略 --- */
        policy: null,

        /* --- 安全设置HTML的辅助函数 --- */
        setSafeHTML: function(element, html) {
            if (this.policy) {
                element.innerHTML = this.policy.createHTML(html);
            } else {
                element.innerHTML = html;
            }
        },

        /* --- 启动脚本 --- */
        init: function() {
            if (this.state.isActive) return;

            /* --- 初始化Trusted Types策略以兼容CSP --- */
            try {
                if (window.trustedTypes && window.trustedTypes.createPolicy) {
                    this.policy = window.trustedTypes.createPolicy('visual-dom-editor-policy', {
                        createHTML: string => string
                    });
                }
            } catch (e) {
                console.error('Visual DOM Editor: TrustedTypes policy creation failed.', e);
            }

            console.log("Visual DOM Editor: Activated.");
            document.body.classList.add('vde-is-active');
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
            const uiElements = [
                document.getElementById(VDE_CONTROL_BOX_ID),
                document.getElementById(VDE_STYLE_ID),
                document.getElementById(VDE_INDICATOR_ID)
            ];
            uiElements.forEach(el => { if (el) el.remove(); });
            if (this.state.hoveredElement) this.state.hoveredElement.classList.remove('vde-highlight');
            document.body.classList.remove('vde-is-active');
            this.state = { isActive: false, selectionHistory: [] }; window.visualDOMEdit = null;
        },

        /* --- CSS 注入 --- */
        injectCSS: function() {
            const css = `
                .vde-is-active .vde-highlight { outline: 2px dashed #007bff !important; outline-offset: -2px; cursor: pointer; }
                .vde-is-active #${VDE_CONTROL_BOX_ID} { position: absolute; border: 2px solid #ff4500; z-index: 99999998; pointer-events: auto; cursor: move; }
                .vde-is-active .vde-resize-handle { position: absolute; width: 12px; height: 12px; background: #ff4500; border: 1px solid white; border-radius: 50%; pointer-events: auto !important; transform: translate(-50%, -50%); }
                
                /* --- 新增：定位8个控制点 --- */
                .vde-is-active .vde-handle-nw { top: 0; left: 0; }
                .vde-is-active .vde-handle-n  { top: 0; left: 50%; }
                .vde-is-active .vde-handle-ne { top: 0; left: 100%; }
                .vde-is-active .vde-handle-w  { top: 50%; left: 0; }
                .vde-is-active .vde-handle-e  { top: 50%; left: 100%; }
                .vde-is-active .vde-handle-sw { top: 100%; left: 0; }
                .vde-is-active .vde-handle-s  { top: 100%; left: 50%; }
                .vde-is-active .vde-handle-se { top: 100%; left: 100%; }

                .vde-is-active .vde-handle-nw, .vde-is-active .vde-handle-se { cursor: nwse-resize; } .vde-is-active .vde-handle-ne, .vde-is-active .vde-handle-sw { cursor: nesw-resize; } .vde-is-active .vde-handle-n, .vde-is-active .vde-handle-s { cursor: ns-resize; } .vde-is-active .vde-handle-w, .vde-is-active .vde-handle-e { cursor: ew-resize; }
                .vde-is-active #${VDE_INDICATOR_ID} { position: absolute; display: flex; align-items: center; background-color: rgba(30, 30, 30, 0.9); color: white; border-radius: 4px; padding: 4px 8px; font-family: sans-serif; font-size: 12px; z-index: 99999999; pointer-events: none; transition: opacity 0.1s ease; opacity: 0; user-select: none; }
                .vde-is-active #${VDE_INDICATOR_ID}.visible { opacity: 1; }
                .vde-is-active .vde-indicator-btn { cursor: pointer; font-weight: bold; padding: 0 5px; font-size: 16px; pointer-events: auto; }
                .vde-is-active .vde-indicator-btn:hover { color: #00aaff; }
                .vde-is-active .vde-indicator-tag { margin: 0 8px; font-family: monospace; }
                .vde-is-active .vde-indicator-actions, .vde-is-active .vde-indicator-z-actions { display: none; margin-left: 8px; border-left: 1px solid #555; padding-left: 8px; }
                .vde-is-active .vde-indicator-done-btn { color: #28a745; }
                .vde-is-active .vde-indicator-cancel-btn { color: #dc3545; margin-left: 5px;}
                .vde-is-active #${VDE_INDICATOR_ID}.editing .vde-indicator-actions, .vde-is-active #${VDE_INDICATOR_ID}.editing .vde-indicator-z-actions { display: inline-flex; align-items: center; }
            `;
            this.ui.styleTag = document.createElement('style');
            this.ui.styleTag.id = VDE_STYLE_ID;
            this.setSafeHTML(this.ui.styleTag, css);
            document.head.appendChild(this.ui.styleTag);
        },

        /* --- UI 创建 --- */
        createUI: function() {
            /* --- 操作框 --- */
            this.ui.controlBox = document.createElement('div');
            this.ui.controlBox.id = VDE_CONTROL_BOX_ID;
            this.ui.controlBox.style.display = 'none';
            ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].forEach(dir => {
                const handle = document.createElement('div'); handle.className = `vde-resize-handle vde-handle-${dir}`; handle.dataset.direction = dir; this.ui.controlBox.appendChild(handle);
            });
            document.body.appendChild(this.ui.controlBox);

            /* --- 指示器 --- */
            this.ui.selectorIndicator = document.createElement('div');
            this.ui.selectorIndicator.id = VDE_INDICATOR_ID;

            this.ui.btnUp = document.createElement('div'); this.ui.btnUp.className = 'vde-indicator-btn'; this.ui.btnUp.title = '选择父元素 (↑)';
            this.setSafeHTML(this.ui.btnUp, '▲');
            this.ui.btnUp.addEventListener('click', (e) => { e.stopPropagation(); this.selectParentElement(); });

            this.ui.btnDown = document.createElement('div'); this.ui.btnDown.className = 'vde-indicator-btn'; this.ui.btnDown.title = '返回子元素 (↓)'; this.ui.btnDown.style.display = 'none';
            this.setSafeHTML(this.ui.btnDown, '▼');
            this.ui.btnDown.addEventListener('click', (e) => { e.stopPropagation(); this.selectChildElement(); });

            this.ui.indicatorTag = document.createElement('span'); this.ui.indicatorTag.className = 'vde-indicator-tag';

            const zActions = document.createElement('div'); zActions.className = 'vde-indicator-z-actions';
            this.ui.btnZDown = document.createElement('div'); this.ui.btnZDown.className = 'vde-indicator-btn'; this.ui.btnZDown.title = '降低层级';
            this.setSafeHTML(this.ui.btnZDown, 'Z▼');
            this.ui.btnZDown.addEventListener('click', (e) => { e.stopPropagation(); this.adjustZIndex('backward'); });

            this.ui.btnZUp = document.createElement('div'); this.ui.btnZUp.className = 'vde-indicator-btn'; this.ui.btnZUp.title = '提升层级';
            this.setSafeHTML(this.ui.btnZUp, 'Z▲');
            this.ui.btnZUp.addEventListener('click', (e) => { e.stopPropagation(); this.adjustZIndex('forward'); });
            zActions.append(this.ui.btnZDown, this.ui.btnZUp);

            const actions = document.createElement('div'); actions.className = 'vde-indicator-actions';
            this.ui.doneBtn = document.createElement('div'); this.ui.doneBtn.className = 'vde-indicator-btn vde-indicator-done-btn'; this.ui.doneBtn.title = '完成调整';
            this.setSafeHTML(this.ui.doneBtn, '✓');
            this.ui.doneBtn.addEventListener('click', (e) => { e.stopPropagation(); this.finalizeSelection(); });

            this.ui.cancelBtn = document.createElement('div'); this.ui.cancelBtn.className = 'vde-indicator-btn vde-indicator-cancel-btn'; this.ui.cancelBtn.title = '取消调整 (Esc)';
            this.setSafeHTML(this.ui.cancelBtn, '✗');
            this.ui.cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); this.cancelSelection(); });
            actions.append(this.ui.doneBtn, this.ui.cancelBtn);

            this.ui.selectorIndicator.append(this.ui.btnUp, this.ui.btnDown, this.ui.indicatorTag, zActions, actions);
            document.body.appendChild(this.ui.selectorIndicator);
        },

        /* --- 核心事件与逻辑 --- */
        handleMouseMove: function(e) {
            this.state.lastMousePosition = { x: e.clientX, y: e.clientY };
            if (this.state.selectedElement) return;
            const target = e.target;
            if (this.isIgnoredElement(target) || target === this.state.hoveredElement) return;
            this.updateHoveredElement(target);
        },
        handleKeyDown: function(e) {
            if (!this.state.hoveredElement && !this.state.selectedElement) return;
            switch(e.key) {
                case 'ArrowUp': e.preventDefault(); this.selectParentElement(); break;
                case 'ArrowDown': e.preventDefault(); this.selectChildElement(); break;
                case 'Escape': if (this.state.selectedElement) { e.preventDefault(); this.cancelSelection(); } break;
                case 'Delete': case 'Backspace': if (this.state.selectedElement) { e.preventDefault(); this.state.selectedElement.style.display = 'none'; this.updateControlBoxPosition(); } break;
            }
        },
        handleClick: function(e) {
            if (e.target.closest(`#${VDE_CONTROL_BOX_ID}, #${VDE_INDICATOR_ID}`)) return;
            e.preventDefault(); e.stopPropagation();
            this.state.selectionHistory = [];
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
            if (newTarget && !this.isIgnoredElement(newTarget)) {
                this.state.selectionHistory.push(currentEl);
                this.changeSelectionTarget(newTarget);
            }
        },
        selectChildElement: function() {
            if (this.state.selectionHistory.length === 0) return;
            const newTarget = this.state.selectionHistory.pop();
            this.changeSelectionTarget(newTarget);
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
                if (this.isIgnoredElement(el) || el === target) return;
                const elRect = el.getBoundingClientRect();
                if (!(elRect.right < targetRect.left || elRect.left > targetRect.right || elRect.bottom < targetRect.top || elRect.top > targetRect.bottom)) {
                    overlappingZIndexes.push(this.getComputedZIndex(el));
                }
            });
            let newZ;
            if (direction === 'forward') {
                const higherZIndexes = overlappingZIndexes.filter(z => z > currentZ);
                newZ = higherZIndexes.length > 0 ? Math.min(...higherZIndexes) + 1 : currentZ + 1;
            } else {
                const lowerZIndexes = overlappingZIndexes.filter(z => z < currentZ);
                newZ = lowerZIndexes.length > 0 ? Math.max(...lowerZIndexes) - 1 : currentZ - 1;
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
            this.state.selectedElement = null; this.state.originalStyles = null; this.state.selectionHistory = [];
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
                display: style.display,
            };
        },
        revertChanges: function() {
            if (!this.state.selectedElement || !this.state.originalStyles) return;
            Object.assign(this.state.selectedElement.style, this.state.originalStyles);
        },

        /* --- 拖拽与缩放操作 --- */
        handleMouseDownAction: function(e) {
            e.preventDefault(); e.stopPropagation();
            const element = this.state.selectedElement;
            const computedStyle = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            this.state.startX = e.clientX;
            this.state.startY = e.clientY;

            /* --- 使用 getComputedStyle 获取初始位置，避免因 offsetParent 导致的偏移 --- */
            this.state.startLeft = parseInt(computedStyle.left, 10) || 0;
            this.state.startTop = parseInt(computedStyle.top, 10) || 0;

            this.state.startWidth = rect.width;
            this.state.startHeight = rect.height;
            this.state.currentAction = e.target.classList.contains('vde-resize-handle') ? 'resizing' : 'dragging';
            if (this.state.currentAction === 'resizing') {
                this.state.resizeDirection = e.target.dataset.direction;
            }
            document.addEventListener('mousemove', this.handleMouseMoveAction, true);
            document.addEventListener('mouseup', this.handleMouseUpAction, true);
        },
        handleMouseMoveAction: function(e) {
            if (!this.state.currentAction) return; e.preventDefault();
            const deltaX = e.clientX - this.state.startX;
            const deltaY = e.clientY - this.state.startY;
            const element = this.state.selectedElement;
            if (this.state.currentAction === 'dragging') {
                element.style.left = `${this.state.startLeft + deltaX}px`;
                element.style.top = `${this.state.startTop + deltaY}px`;
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
        isIgnoredElement: function(element) {
            if (!element || !element.tagName) return true;
            const tagName = element.tagName.toUpperCase();
            if (['HTML', 'BODY', 'SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE'].includes(tagName)) return true;
            if (element.id === VDE_CONTROL_BOX_ID || element.id === VDE_INDICATOR_ID || element.closest(`#${VDE_CONTROL_BOX_ID}, #${VDE_INDICATOR_ID}`)) return true;
            return false;
        },
        getElementSelector: function(element) {
            if (!element) return '';
            let selector = element.tagName.toLowerCase();
            if (element.id) selector += `#${element.id}`;
            if (element.className && typeof element.className === 'string') {
                selector += `.${element.className.trim().split(/\s+/).join('.')}`;
            }
            return selector;
        },
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
            this.ui.indicatorTag.textContent = `${this.getElementSelector(target)} (z:${this.getComputedZIndex(target)})`;
            this.ui.btnDown.style.display = this.state.selectionHistory.length > 0 ? 'block' : 'none';
            indicator.classList.add('visible');
        },
        updateControlBoxPosition: function() {
            if (!this.state.selectedElement) return;
            const rect = this.state.selectedElement.getBoundingClientRect();
            const box = this.ui.controlBox;
            if (rect.width === 0 && rect.height === 0) {
                box.style.display = 'none';
            } else {
                box.style.display = 'block';
                box.style.left = `${rect.left + window.pageXOffset}px`; box.style.top = `${rect.top + window.pageYOffset}px`;
                box.style.width = `${rect.width}px`; box.style.height = `${rect.height}px`;
            }
            this.updateIndicator();
        }
    };

    /* --- 绑定 this 上下文 --- */
    for (let key in VDE) { if (typeof VDE[key] === 'function') { VDE[key] = VDE[key].bind(VDE); } }

    /* --- 启动 --- */
    VDE.init();
})();