/**
 * Communicate with popup
 */
var listener = function(msg, _, sendResponse) {
    console.log('Got message from onepage.  Request type: ' + msg.requestType);
    if (msg.requestType == 'ping') {
        return { pong: true };
    }
    else if (msg.requestType == "replaceDOMElements") {
        try {
            var toReplace = $(document).find(msg.selector);
            if (!msg.replaceMultiple)
                toReplace = toReplace[0];

            var toInsert = $(msg.elmToInsertHtml)[0];

            if (toReplace && toInsert) {
                toReplace.replaceWith(toInsert);
                sendResponse({ success: true });
            }
        } catch (ex) {
            sendResponse({ success: false, error: ex });
        }
    } 
    else if (msg.requestType == "addClassToDOMElements") {
        try {
            var elms = $(document).find(msg.selector);
            elms.addClass(msg.classToAdd);
            sendResponse({ success: true, numLoaded: elms.length });
        } catch (ex) {
            sendResponse({ success: false, error: ex });
        }
        sendResponse({ success: true });
    }
    else {
        sendResponse({});
    }
};

chrome.runtime.onMessage.addListener(listener);