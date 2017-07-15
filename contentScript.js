var NOT_SUPPORTED_ERROR = 'Sorry, this site is not yet supported by onepage.  Email onepage.suggest@gmail.com if you want me to add it!';
var GENERIC_ERROR = 'Something went wrong. :( Let me know: onepage.suggest@gmail.com.';
/**
 * Performs initialization that doesn't depend on the DOM.
 */
function init() {
    // Call sharedInit from sharedContentPopup, which will check whether the site is supported
    // and display a popup if it is.
    sharedInit(getCurrentTabUrl, renderStatus, displayResult, displayButtonNote, false);
}

init();

/**
 * Gets the current URL and then calls callback.
 * Since this is running on the page, it doesn't need to do anything fancy to get it.
 */
function getCurrentTabUrl(callback) {
    callback(document.location.href);
}

/**
 * Display status in popup.
 * TODO 
 */
function renderStatus(statusText, secondaryStatus) {
    console.log('renderStatus placeholder!! ' + statusText + ' ' + secondaryStatus);
}

/**
 * Show status, hide the loading 'spinner', and reenable the button.
 * TODO
 */
function displayResult(message, reenableButton) {
    console.error('displayResult placeholder!! ' + message + ' ' + reenableButton);
}

/**
 * Show small message under primary button.
 * TODO
 */
function displayButtonNote(message) {
    console.error('displayButtonNote placeholder!! ' + message);
}

/**
 * Loads the entire article.
 * TODO
 */
function loadAll(url, baseSite) {
    var siteInfo = getSupportedSitesInfo()[baseSite];

    // Load spinner and disable button
    $('.spinner').removeClass('hidden');
    $('#depaginateBtn').attr('disabled', true);

    // Create a new div that we will insert onto the page
    var fullArticleContainer = $('<div id="newArticleBody"></div>');

    // Call the handler for the particular site.
    // (Is it weird to pass siteInfo in?  I did it this way because I'm kinda treating these like classes,
    // reluctant to totally give up the approach I used in my first attempt, in which I tried to come up with
    // a set of general methods like getReplaceFormat(), isLastPage(), and so on, and do most of the work here.)
    try {
        var result = siteInfo.loadAll(siteInfo, fullArticleContainer, url); 
    }
    catch (ex) {
        displayResult(GENERIC_ERROR, true);
        console.error(ex);
    }
} 

/*
 * Does all DOM-related work. 
 */
function doDomWork(msg, sendResponse) {
    if (msg.requestType == "replaceDOMElements") {
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
            console.error(ex);
            sendResponse({ success: false, error: ex });
        }
    } 
    else if (msg.requestType == "addClassToDOMElements") {
        try {
            var elms = $(document).find(msg.selector);
            elms.addClass(msg.classToAdd);
            sendResponse({ success: true, numLoaded: elms.length });
        } catch (ex) {
            console.error(ex);
            sendResponse({ success: false, error: ex });
        }
        sendResponse({ success: true });
    }
    else if (msg.requestType == "triggerEventOnDOMElement") {
        try {
            var elm = $(document).find(msg.selector);
            if (msg.event == 'click') {
                elm[0].click();
            }
            else {
                elm[0].trigger(msg.event);
            }
        } catch (ex) {
            console.error(ex);
            sendResponse({ success: false, error: ex });
        }
        sendResponse({ success: true });
    }
    else {
        sendResponse({});
    }
}

/**
 * Communicates with popup.
 */
var msgIdsReceived = {};
var listener = function(msg, _, sendResponse) {
    console.log('Got message from onepage popup.  Request type: ' + msg.requestType + ' & message ID: ' + msg.id);
    if (msgIdsReceived[msg.id]) {
        return;
    }
    //msgIdsReceived[msg.id] = true;

    if (msg.requestType == 'ping') {
        return { pong: true };
    }
    else {
        doDomWork(msg, sendResponse);
    }
};

chrome.runtime.onMessage.addListener(listener);