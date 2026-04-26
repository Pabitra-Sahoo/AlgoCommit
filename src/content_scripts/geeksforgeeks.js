// Content script for GeeksForGeeks

console.log("AlgoCommit: GeeksForGeeks content script loaded.");

let isExtracting = false;

// Function to extract code via scout injection (bypasses DOM virtualization)
function extractCodeViaScout() {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('gfg-scout.js');
    
    const listener = (event) => {
      if (event.source !== window || !event.data || event.data.type !== 'ALGOC_GFG_CODE') return;
      window.removeEventListener('message', listener);
      if (script.parentNode) script.parentNode.removeChild(script);
      resolve(event.data.code);
    };
    
    window.addEventListener('message', listener);
    (document.head || document.documentElement).appendChild(script);
    
    // Timeout fallback (1.5 seconds)
    setTimeout(() => {
      window.removeEventListener('message', listener);
      if (script.parentNode) script.parentNode.removeChild(script);
      resolve(null);
    }, 1500);
  });
}

// Function to read code directly from the DOM without executing inline scripts
async function extractCodeFromEditor() {
    try {
        // Primary Method: Scout Injection (Accurate, gets full code)
        let code = await extractCodeViaScout();
        if (code && code.trim().length > 0) {
            console.log("AlgoCommit: Code extracted via Scout.");
            return code;
        }

        console.log("AlgoCommit: Scout failed or empty, falling back to DOM scraping...");

        // Method 1: Check if the text is available in plain DOM element (Modern GfG)
        const viewLines = document.querySelector('.view-lines');
        if (viewLines) {
            code = viewLines.innerText;
            if (code && code.trim().length > 0) return code;
        }
        
        // Method 2: Try to find any active Ace Editor textareas
        const aceTextareas = document.querySelectorAll('.ace_text-input');
        for (let ta of aceTextareas) {
            if (ta.value && ta.value.length > 5) {
                return ta.value;
            }
        }

        // Method 3: Grab from the Ace Editor print margin/layer
        const aceLayer = document.querySelector('.ace_text-layer');
        if (aceLayer) {
            code = Array.from(aceLayer.querySelectorAll('.ace_line'))
                        .map(line => line.innerText)
                        .join('\n');
            if (code && code.trim().length > 0) return code;
        }

        // Method 4: Fallback to any visible element that looks like a code block (CodeMirror)
        const codeBlock = document.querySelector('.CodeMirror-code');
        if (codeBlock) {
            code = codeBlock.innerText;
            if (code && code.trim().length > 0) return code;
        }

        const genericCodeContainer = document.querySelector('.brxe-code') || document.querySelector('code');
        if (genericCodeContainer) {
             return genericCodeContainer.innerText;
        }

        console.warn("AlgoCommit: Could not locate code in DOM via direct selectors.");
        return "";
        
    } catch (err) {
        console.error("AlgoCommit Code Extraction Error:", err);
        return "";
    }
}

function startContinuousMonitoring() {
    console.log("AlgoCommit: Started continuous monitoring for success messages...");
    
    // We run a check every 2 seconds, indefinitely.
    // This entirely bypasses React event swallowing problems.
    setInterval(async () => {
        if (isExtracting) return;

        const bodyText = document.body.innerText || "";
        // Look for multiple variations of success messages
        if (bodyText.includes("Problem Solved Successfully") || 
            bodyText.includes("Correct Answer") || 
            bodyText.includes("Execution Successful") ||
            document.querySelector('.success-msg')) { // Look for a common success class
            
            console.log("AlgoCommit: Successful GfG submission detected in DOM!");
            
            isExtracting = true;
            await handleSuccessfulSubmission();
            
            // Wait 10 seconds before allowing another extraction to prevent duplicates on the same page
            setTimeout(() => { isExtracting = false; }, 10000);
        }
    }, 2000);
}

// Start monitoring as soon as the script loads
startContinuousMonitoring();

async function handleSuccessfulSubmission() {
  try {
    console.log("AlgoCommit: Starting to extract problem details...");

    // 1. Get Code
    const code = await extractCodeFromEditor();
    if (!code) {
        console.error("AlgoCommit: Failed to extract code from GfG editor. Payload aborted.");
        return;
    }
    console.log("AlgoCommit: Successfully extracted code. Length:", code.length);

    // 2. Extract Problem Details
    const titleEl = document.querySelector('[class^="problems_header_content__title"] > h3') 
                 || document.querySelector('.problem-tab__name')
                 || document.querySelector('.g-m-0');
                 
    let title = document.title ? document.title.split('|')[0].trim() : "Unknown Problem";
    if (titleEl && titleEl.innerText) title = titleEl.innerText.trim();
    console.log("AlgoCommit: Extracted title:", title);

    let difficulty = "Medium"; // Safe default fallback
    const difficultyLevels = ["School", "Basic", "Easy", "Medium", "Hard"];
    
    // Primary: Match "Difficulty: Easy" pattern from the scrollable content area
    const contentArea = document.getElementById('scrollableDiv') || document.body;
    const diffMatch = contentArea.textContent.match(/Difficulty\s*:\s*(\w+)/i);
    if (diffMatch && difficultyLevels.includes(diffMatch[1])) {
        difficulty = diffMatch[1];
    } else {
        // Fallback: scan leaf elements for an exact difficulty word
        const candidates = document.querySelectorAll('span, strong, p, div');
        for (let el of candidates) {
            const text = el.innerText?.trim();
            if (difficultyLevels.includes(text) && el.children.length === 0) {
                difficulty = text;
                break;
            }
        }
    }
    console.log("AlgoCommit: Extracted difficulty:", difficulty);

    const problemStatementEl = document.querySelector('[class^="problems_problem_content"]') 
                            || document.querySelector('.problem-statement')
                            || document.querySelector('.problems_problem_content__Xm_eO')
                            || document.querySelector('.left-pane');
                            
    const description = problemStatementEl ? problemStatementEl.innerHTML : "";
    console.log("AlgoCommit: Extracted description HTML. Length:", description.length);

    // 3. Extract Language
    // GfG usually has a language dropdown showing active language
    const langEl = document.querySelector('.divider.text') 
                || document.querySelector('[class*="languageSelect"]')
                || document.querySelector('.g-btn-active');
                
    const language = langEl && langEl.innerText ? langEl.innerText.split('(')[0].trim() : "cpp"; // default fallback
    console.log("AlgoCommit: Extracted language:", language);

    // 4. Format Payload
    const payload = {
      platform: "GeeksForGeeks",
      title: String(title),
      difficulty: String(difficulty),
      description: `<h2><a href="${window.location.href}">${title}</a></h2><h3>Difficulty Level: ${difficulty}</h3><hr>${description}`,
      language: String(language),
      code: String(code),
      url: window.location.href,
    };

    console.log("AlgoCommit: Sending payload to background...");

    // 5. Send to background for syncing
    chrome.runtime.sendMessage({ type: "SYNC_PROBLEM", payload }, (res) => {
      console.log("AlgoCommit: Background sync response:", res);
    });

  } catch (err) {
      console.error("AlgoCommit Extraction Error:", err);
  }
}
