/**
 * Communicate with popup
 */
chrome.runtime.onMessage.addListener(function(msg, _, sendResponse) {
    if (msg.requestType == "replaceDOMElement") {
        try {
            var elmToReplace = $(document).find(msg.selector)[0];
            elmToReplace.replaceWith($(msg.elmToInsertStr)[0]);
            sendResponse({ success: true });
        } catch (e) {
            sendResponse({ success: false, error: e });
        }
    } else {
        sendResponse({});
    }
});