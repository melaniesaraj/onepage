/**
 * Communicate with popup
 */
var listener = function(msg, _, sendResponse) {
    console.log('Got message from onepage.  Request type: ' + msg.requestType);
    if (msg.requestType == "replaceDOMElement") {
        try {
            var elmToReplace = $(document).find(msg.selector)[0];
            elmToReplace.replaceWith($(msg.elmToInsertStr)[0]);
            sendResponse({ success: true });
        } catch (e) {
            sendResponse({ success: false, error: e });
        }
    } else if (msg.requestType == "addClassToDOMElement") {
        try {
            var elms = $(document).find(msg.selector);
            elms.addClass(msg.classToAdd);
            sendResponse({ success: true, numLoaded: elms.length });
        } catch (e) {
            sendResponse({ success: false, error: e });
        }
        sendResponse({ success: true });
    }
    else {
        sendResponse({});
    }
};

chrome.runtime.onMessage.addListener(listener);