(function() {
    let code = "";
    try {
        // 1. Try Monaco Editor (Modern GFG)
        if (typeof monaco !== 'undefined' && monaco.editor) {
            const models = monaco.editor.getModels();
            if (models && models.length > 0) {
                code = models[0].getValue();
            }
        }
        
        // 2. Try Ace Editor (Standard GFG)
        if (!code && typeof ace !== 'undefined') {
            const aceEl = document.querySelector('.ace_editor');
            if (aceEl) {
                const editor = ace.edit(aceEl);
                if (editor) {
                    code = editor.getValue();
                }
            }
        }

        // 3. Try CodeMirror Fallback
        if (!code) {
            const cmEl = document.querySelector('.CodeMirror');
            if (cmEl && cmEl.CodeMirror) {
                code = cmEl.CodeMirror.getValue();
            }
        }
    } catch (e) {
        console.error("[AlgoCommit Scout] Error extracting code:", e);
    }
    
    // Send it back to the content script
    window.postMessage({ type: 'ALGOC_GFG_CODE', code: code || "" }, '*');
})();
