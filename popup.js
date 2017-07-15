/**
 * Performs initialization that doesn't depend on the DOM.
 */
function init() {
    // Call sharedInit from sharedContentPopup, which will check whether the site is supported
    // and display relevant info in the popup.
    sharedInit(getCurrentTabUrl, renderStatus, displayResult, displayButtonNote, true);
}

/**
 * When the popup has loaded, checks the URL to see if it's supported.  Wires up the De-paginate
 * button if so.
 */
document.addEventListener('DOMContentLoaded', function () {
    init();
});

/**
 * Gets the current URL and then calls callback.
 */
function getCurrentTabUrl(callback) {
    // See https://developer.chrome.com/extensions/tabs#method-query
    var queryInfo = {
        active: true,
        currentWindow: true
    };
    // See https://developer.chrome.com/extensions/tabs#type-Tab
    chrome.tabs.query(queryInfo, function (tabs) {
        var tab = tabs[0];
        var url = tab.url;
        callback(url);
    });
}

/**
 * Makes sure my script is injected into the background page before sending it a message.
 * 
 * Thanks, StackOverflow user Xan! http://stackoverflow.com/a/23895822/1882961 
 */
function ensureSendMessage(tabId, message, callback) {
    // message.id = Math.random().toString(36).substr(2, 5);
    // chrome.tabs.sendMessage(tabId, { requestType: 'ping' }, function (response) {
    //     if (response && response.pong) {
    //         // Content script ready
    chrome.tabs.sendMessage(tabId, message, callback);
    //     } 
    //     else { 
    //         // No listener on the other end
    //         chrome.tabs.executeScript(tabId, { file: 'contentScript.js' }, function () {
    //             if (chrome.runtime.lastError) {
    //                 console.error(chrome.runtime.lastError);
    //             }
    //             // OK, now it's injected and ready
    //             chrome.tabs.sendMessage(tabId, message, callback);
    //         });
    //     }
    // });
}

/**
 * Sends a message requesting to replace an element with another to the script running on the page
 * and then calls callback.
 */
function replaceDOMElements(selector, elmToInsertHtml, callback, replaceMultiple) {
    var queryInfo = { active: true, currentWindow: true };
    chrome.tabs.query(queryInfo, function (tabs) {
        var tab = tabs[0];
        chrome.tabs.getSelected(null, function(tab) {
            ensureSendMessage(tab.id, 
                { requestType: "replaceDOMElements", selector: selector, 
                    elmToInsertHtml: elmToInsertHtml, replaceMultiple: replaceMultiple },
                function (response) {
                    if (!response) {
                        displayResult('Page isn\'t ready (not the extension\'s fault!) - try again in a few seconds.  Refreshing could help too.',
                            true); // reenable button
                        return;
                    }
                    callback(response);
                });
        });
    });
}

/**
 * Sends a message requesting to add a class to element(s) to the script running on the page and
 * then calls callback.
 */
function addClassToDOMElements(selector, classToAdd, callback) {
    var queryInfo = { active: true, currentWindow: true };
    chrome.tabs.query(queryInfo, function (tabs) {
        var tab = tabs[0];
        chrome.tabs.getSelected(null, function(tab) {
            ensureSendMessage(tab.id, 
            { requestType: "addClassToDOMElements", selector: selector, classToAdd: classToAdd },
            function (response) {
                if (!response) {
                    displayResult('Page isn\'t ready (not the extension\'s fault!) - try again in a few seconds.  Refreshing could help too.',
                        true); // reenable button
                    return;
                }
                callback(response);
            });
        });
    });
}

/**
 * Sends a message to the script running on the page requesting to trigger an event on an element,
 * then calls callback.
 */
function triggerEventOnDOMElement(selector, event, callback) {
    var queryInfo = { active: true, currentWindow: true };
    chrome.tabs.query(queryInfo, function (tabs) {
        var tab = tabs[0];
        chrome.tabs.getSelected(null, function(tab) {
            ensureSendMessage(tab.id, 
            { requestType: "triggerEventOnDOMElement", selector: selector, event: event },
            function (response) {
                if (!response) {
                    displayResult('Page isn\'t ready (not the extension\'s fault!) - try again in a few seconds.  Refreshing could help too.',
                        true); // reenable button
                    return;
                }
                callback(response);
            });
        });
    });
}

/**
 * Displays status in popup.
 */
function renderStatus(statusText, secondaryStatus) {
    var statusDiv;
    if (secondaryStatus) {
        statusDiv = document.getElementById('secondaryStatus'); 
    }
    else {
        statusDiv = document.getElementById('status');
    }
    statusDiv.textContent = statusText;
    $(statusDiv).removeClass('hidden');
}

/**
 * Shows status, hides the loading 'spinner', and reenables the button.
 */
function displayResult(message, reenableButton) {
    renderStatus(message);
    $('.spinner').addClass('hidden');
    if (reenableButton) {
        $('#depaginateBtn').removeAttr('disabled');
    }
}

/**
 * Shows small message under primary button.
 */
function displayButtonNote(message) {
    var buttonNote = document.getElementById('buttonNote');
    buttonNote.textContent = message;
    $(buttonNote).removeClass('hidden');
}