/**
 * Perform initialization that doesn't depend on the DOM.
 */
function init() {
    // Define string.format
    String.prototype.format = function() {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function(match, number) { 
            return typeof args[number] != 'undefined' ? args[number] : match;
        });
    };
}

init();

/**
 * Get the current URL and then call callback.
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
 * Send a message requesting to replace an element with another to the script running on the page
 * and then call callback.
 */
function replacePageElement(selector, elmToInsertStr, callback) {
    var queryInfo = {
        active: true,
        currentWindow: true
    };
    chrome.tabs.query(queryInfo, function (tabs) {
        var tab = tabs[0];
        chrome.tabs.getSelected(null, function(tab) {
            chrome.tabs.sendMessage(tab.id, 
            { requestType: "replaceDOMElement", selector: selector, elmToInsertStr: elmToInsertStr }, 
            function (response) {
                if (!response) {
                    renderStatus('Page isn\'t ready (not the extension\'s fault!) - try again in a few seconds');
                    $('#depaginateBtn').removeAttr('disabled');
                    $('.spinner').addClass('hidden');
                    return;
                }
                callback(response);
            });
        });
    });
}

/**
 * When the popup has loaded, check the URL to see if it's supported.  Wire up the De-paginate
 * button if so.
 */
document.addEventListener('DOMContentLoaded', function () {
    getCurrentTabUrl(function (url) {
        var btn = $('#depaginateBtn');

        // Get the whatever.whatever part of the URL, since that's the key used to store 
        // site-specific info
        var urlRegExp = /^(?:(?:http[s]?|ftp):\/)?\/?(?:www\.)*([^:\/\s]+)/i;
        var matches = url.match(urlRegExp);
        if (matches.length < 2) {
            renderStatus('Invalid URL format :(');
            return; 
        }

        // See if we have info on how to handle this site
        var sitesInfo = getSupportedSitesInfo();
        if (!sitesInfo.hasOwnProperty(matches[1])) {
            renderStatus('Sorry, this site is not yet supported. (In fact, only knowable.com is supported lolol hello world)');
            return;
        }

        // We do!  Display message and attach handler to button
        btn.removeAttr('disabled');
        renderStatus('Annoying page detected. Fix it?');
        btn.on('click', function(evt) {
            loadAll(url, matches[1]);
        });
    });
});

/**
 * Load the entire article.)
 */
function loadAll(url, baseSite) {
    var siteInfo = getSupportedSitesInfo()[baseSite];
    var urlFormat = siteInfo.getReplaceFormat(url);

    // Load spinner and disable button
    $('.spinner').removeClass('hidden');
    $('#depaginateBtn').attr('disabled', true);

    // Create a new div that we will insert onto the page
    var fullArticleContainer = $('<div id="newArticleBody" class="' +  siteInfo.articleMeatSelector + '">-mnk-</div>');

    // Recursively retrieve pages of article until the last one
    var addPage = function (pageNum) {
        httpGet(urlFormat.format(pageNum), function (responseText) {
            var html = $.parseHTML(responseText);
            var articleMeat = $(html).find(siteInfo.articleMeatSelector);
            fullArticleContainer.append(articleMeat);

            // Examine the page.  If it's the last one, add the elements to the page;
            // toherwise, keep going.
            if (siteInfo.isLastPage(responseText)) {
                // Done - get the element (TODO: or elements) containing the meat of the article;
                // replace with the element that we created.
                replacePageElement(siteInfo.articleMeatSelector, fullArticleContainer[0].outerHTML, function (msg) {
                    if (msg && msg.success) {
                        renderStatus('Loaded ' + (pageNum) + ' pages');
                    }
                    else {
                        renderStatus('Something went wrong.');
                    }
                    $('.spinner').addClass('hidden');
                });
            }
            else {
                addPage(pageNum + 1);
            }
        });
    }
    addPage(1);
} 

/**
 * Asynchronously request page.
 */
function httpGet(url, callback) {
    console.log('requesting ' + url);
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.open('GET', url); 
    xmlHttp.onload = function () {
        console.log('got ' + url);
        if (!xmlHttp.responseText)
            return;
        callback(xmlHttp.responseText);
    };
    xmlHttp.onError = function () {
        // TODO
    };
    xmlHttp.send();
}

/**
 * Stores info about particular websites: how their article URLs are formed, where on the page
 * the meat of the articles are found, and how to know by looking at the HTML of a page whether
 * it is the last page of the article. 
 * 
 * Least generalizable thing ever written, but the idea is to get something working before we make
 * a more intelligent, general algorithm.
 */
function getSupportedSitesInfo() {
    return {
        "knowable.com": {
            // Example URLs:
            // http://www.knowable.com/a/article-title-here
            // http://www.knowable.com/a/article-title-here/
            // http://www.knowable.com/a/article-title-here/p-10
            // http://www.knowable.com/a/article-title-here/p-10/
            // http://www.knowable.com/a/article-title-here/p-10#something
            // http://www.knowable.com/a/article-title-here/p-10?x=y
            getReplaceFormat: function (url) {
                    console.log('url=' + url);
                var ret = '';
                var protocol = '';
                var protocolEnd = url.indexOf('://');
                if (protocolEnd >= 0) {
                    protocol = url.substring(0, protocolEnd + 3);
                    url = url.substring(protocolEnd + 3);
                }
                var parts = url.split('/');
                if (parts.length < 3 || parts[1] != 'a') {
                    return '';
                }
                if (parts.length == 3) { // nothing after the article title
                    console.log(protocol);
                    return (protocol ? protocol : 'http://') + url + '/p-{0}';
                }
                if (parts.length == 4 && parts[3] == '') { // nothing after title, trailing slash
                    return (protocol ? protocol : 'http://') + url + 'p-{0}';
                }
                var pageRegExp = /^(p-)([0-9]*)((?:\?.*)|(?:#.*))?/i;
                var matches = parts[3].match(pageRegExp);
                if (!matches || matches.length < 2) {
                    renderStatus('Invalid URL format :(');
                }
                // Reconstruct URL - start with 1 because 0 is the full match
                ret = (protocol ? protocol : 'http://') + parts[0] + '/' + parts[1] + '/' + parts[2] + '/';
                for (var i = 1; i < matches.length; i++) {
                    if (matches[i] == null)
                        continue;
                    if (i == 2)
                        ret += '{0}';
                    else
                        ret += matches[i];
                }
                return ret;
            },
            articleMeatSelector: '.article-body',
            isLastPage: function (responseText) {
                // If there isn't a 'Next' button, or there is one that links to '/t/end-gallery',
                // this is the last page
                var html = $.parseHTML(responseText);
                var nextLink = $(html).find('.article-body .btn-next-xl');
                return (!nextLink.length || nextLink.attr('href') == '/t/end-gallery');
            }
        }
    }
}

/**
 * Display status in popup.
 */
function renderStatus(statusText) {
    var statusDiv = document.getElementById('status');
    statusDiv.textContent = statusText;
    $(statusDiv).removeClass('hidden');
}
