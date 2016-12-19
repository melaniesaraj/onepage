/**
 * Performs initialization that doesn't depend on the DOM.
 */
var deslideSites = { };
function init() {
    // Define string.format
    String.prototype.format = function() {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function(match, number) { 
            return typeof args[number] != 'undefined' ? args[number] : match;
        });
    };
    // Gets list of sites supported by http://www.deslide.clusterfake.net
    deslideSites = getDeslideSupportedSites();
}

init();

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
    chrome.tabs.sendMessage(tabId, { requestType: 'ping' }, function (response) {
        if (response && response.pong) {
            // Content script ready
            chrome.tabs.sendMessage(tabId, message, callback);
        } 
        else { 
            // No listener on the other end
            chrome.tabs.executeScript(tabId, { file: 'contentScript.js' }, function () {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError);
                }
                // OK, now it's injected and ready
                chrome.tabs.sendMessage(tabId, message, callback);
            });
        }
    });
}

/**
 * Sends a message requesting to replace an element with another to the script running on the page
 * and then calls callback.
 */
function replaceDOMElements(selector, elmToInsertHtml, callback, replaceMultiple) {
    var queryInfo = {
        active: true,
        currentWindow: true
    };
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
 * When the popup has loaded, checks the URL to see if it's supported.  Wires up the De-paginate
 * button if so.
 */
var NOT_SUPPORTED_ERROR = 'Sorry, this site is not yet supported by onepage.  Email onepage.suggest@gmail.com if you want me to add it!';
var GENERIC_ERROR = 'Something went wrong. :( Let me know: onepage.suggest@gmail.com.';
document.addEventListener('DOMContentLoaded', function () {
    try {
        getCurrentTabUrl(function (url) {
            var btn = $('#depaginateBtn');

            // Get the whatever.whatever part of the URL, since that's the key used to store 
            // site-specific info
            var urlRegExp = /^(?:(?:http[s]?|ftp):\/)?\/?(?:www\.)*([^:\/\s]+)/i;
            var matches = url.match(urlRegExp);
            if (matches.length < 2) {
                renderStatus('Invalid URL format. :( Let me know: onepage.suggest@gmail.com.');
                return; 
            }

            // See if we have info on how to handle this site
            var sitesInfo = getSupportedSitesInfo();
            var supported = sitesInfo.hasOwnProperty(matches[1]);
            if (!supported) {
                renderStatus(NOT_SUPPORTED_ERROR); // but Deslide may have support, so don't return
            }
            else {
                // We do!  Display message and attach handler to button
                btn.removeAttr('disabled');
                renderStatus('Annoying page detected. Fix it?');
                btn.on('click', function(evt) {
                    loadAll(url, matches[1]);
                });
            }

            // See if http://www.deslide.clusterfake.net supports this site and show a link if so
            var deslideSupportedFormat = deslideSites[matches[1]];
            if (!!deslideSupportedFormat) {
                renderStatus('Looks like it\'s available on Deslide' + (supported ? ' too' : '') + '! Try the link below!', true);
                var deslideUrl = 'http://deslide.clusterfake.net/?u=' + escape(url);
                if (deslideSupportedFormat != matches[1])
                    deslideUrl += '&handler=' + deslideSupportedFormat;
                $('#deslideLink').attr('href', deslideUrl);
                $('#deslideLink').removeClass('hidden');
            }
        });
    }
    catch (ex) {
        displayResult(GENERIC_ERROR);
        console.error(ex);
    }
});

/**
 * Loads the entire article.
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

/**
 * Asynchronously requests page.
 */
function httpGet(url, callback) {
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.open('GET', url); 
    xmlHttp.onload = function () {
        if (!xmlHttp.responseText)
            return;
        callback(xmlHttp.responseText);
    };
    xmlHttp.onError = function (ex) {
        // TODO what else idk
        console.error(ex);
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
    var sites = {

        // Example URLs:
        // Anything containing refinery29.com
        "refinery29.com": {
            loadAll: function (thisInfo, fullArticleContainer, url) {
                addClassToDOMElements('.opener', 'isVisible active', function (unused) {
                    addClassToDOMElements('.slide', 'isVisible active', function (msg) {
                        displayResult('Loaded ' + (msg.numLoaded ? msg.numLoaded : 'all') + ' slides');
                    });
                });
            }
        },

        "knowable.com": {
            // Example URLs:
            // http://www.knowable.com/a/article-title-here
            // http://www.knowable.com/a/article-title-here/
            // http://www.knowable.com/a/article-title-here/p-10
            // http://www.knowable.com/a/article-title-here/p-10/
            // http://www.knowable.com/a/article-title-here/p-10#something
            // http://www.knowable.com/a/article-title-here/p-10?x=y
            getReplaceFormat: function (url) {
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
            },
            loadAll: function (thisInfo, fullArticleContainer, url) {
                // Recursively retrieve pages of article until the last one
                var urlFormat = thisInfo.getReplaceFormat(url);
                var addPage = function (pageNum) {
                    httpGet(urlFormat.format(pageNum), function (responseText) {
                        // Get the meat of the article and append it to our fullArticleContainer element
                        var html = $.parseHTML(responseText);
                        var articleMeat = $(html).find(thisInfo.articleMeatSelector);
                        if (pageNum > 1) { // hide article title after page 1
                            articleMeat.find('.article-header').addClass('hidden');
                        }
                        articleMeat.find('.article-footer-v2').addClass('hidden');
                        
                        fullArticleContainer.append(articleMeat);

                        // Examine the page.  If it's the last one, add the elements to the page;
                        // otherwise, keep going.
                        if (thisInfo.isLastPage(responseText)) {
                            fullArticleContainer.addClass(thisInfo.articleMeatSelector);
                            // Done - get the appropriate element on the page and replace it with 
                            // the element that we created.
                            replaceDOMElements(thisInfo.articleMeatSelector, fullArticleContainer[0].outerHTML, function (msg) {
                                if (msg && msg.success) {
                                    displayResult('Loaded ' + (pageNum) + ' pages');
                                }
                                else {
                                    displayResult(GENERIC_ERROR);
                                }
                            });
                        }
                        else {
                            addPage(pageNum + 1);
                        }
                    });
                }
                addPage(1);
            }
        },

        "suggest.com": {
            // Example URLs:
            // http://www.suggest.com/section/article-title-here
            // http://www.suggest.com/section/article-title-here/
            // http://www.suggest.com/section/article-title-here/?story_page=10
            // http://www.suggest.com/section/article-title-here/?story_page=10#something
            // http://www.suggest.com/section/article-title-here/?story_page=10&something 
            getReplaceFormat: function (url) {
                var ret = '';
                var protocol = '';
                var protocolEnd = url.indexOf('://');
                if (protocolEnd >= 0) {
                    protocol = url.substring(0, protocolEnd + 3);
                    url = url.substring(protocolEnd + 3);
                }
                var parts = url.split('/');
                if (parts.length < 4) {
                    return '';
                }
                if (parts.length == 4) { // nothing after the article title
                    return (protocol ? protocol : 'http://') + url + '?story_page={0}';
                }
                if (parts.length == 5 && parts[4] == '') { // nothing after title, trailing slash
                    return (protocol ? protocol : 'http://') + url + '?story_page={0}';
                }
                var pageRegExp = /^(\?story_page=)([0-9]*)((?:\?.*)|(?:#.*))?/i;
                var matches = parts[4].match(pageRegExp);
                if (matches == null || matches.length < 2) {
                    renderStatus('Invalid URL format :(');
                }
                // Reconstruct URL - start with 1 because 0 is the full match
                ret = (protocol ? protocol : 'http://') + parts[0] + '/' + parts[1] + '/' + parts[2] + '/' + parts[3] + '/';
                for (var i = 1; i < matches.length; i++) {
                    if (matches[i] == null)
                        continue;
                    if (i == 3 || (i == 2 && !matches[3])) // lol whatever
                        ret += '{0}';
                    else
                        ret += matches[i];
                }
                return ret;
            },
            articleMeatSelector: '.slide',
            isLastPage: function (responseText) {
                // If there isn't a 'Next' button, or there is one that links to '#',
                // this is the last page
                var html = $.parseHTML(responseText);
                var nextLink = $(html).find('.next-story');
                return (!nextLink.length || nextLink.attr('href').indexOf('story_page') == -1); // next page is a new article
            },
            loadAll: function (thisInfo, fullArticleContainer, url) {
                // Recursively retrieve pages of article until the last one
                var urlFormat = thisInfo.getReplaceFormat(url);
                var addPage = function (pageNum) {
                    httpGet(urlFormat.format(pageNum), function (responseText) {
                        // Get the meat of the article and append it to our fullArticleContainer element
                        var html = $.parseHTML(responseText);
                        var articleMeat = $(html).find(thisInfo.articleMeatSelector);
                        fullArticleContainer.append(articleMeat);

                        // Examine the page.  If it's the last one, add the elements to the page;
                        // otherwise, keep going.
                        if (thisInfo.isLastPage(responseText)) {
                            fullArticleContainer.addClass(thisInfo.articleMeatSelector + ' partial content_story_pages_slide primary');
                            // Done - get the appropriate element on the page and replace it with 
                            // the element that we created.
                            replaceDOMElements('.slot[data-slot="center"]', fullArticleContainer[0].outerHTML, function (msg) {
                                if (msg && msg.success) {
                                    displayResult('Loaded ' + (pageNum) + ' pages');
                                }
                                else {
                                    displayResult(GENERIC_ERROR);
                                }
                            });
                        }
                        else {
                            addPage(pageNum + 1);
                        }
                    });
                }
                addPage(1);
            }
        },

        "emgn.com": {
            // Example URLs:
            // http://www.emgn.com/s3/article-title-here
            // http://www.emgn.com/s3/article-title-here/
            // http://www.emgn.com/s3/article-title-here/10
            // http://www.emgn.com/s3/article-title-here/10/
            // http://www.emgn.com/s3/article-title-here/10#something
            // http://www.emgn.com/s3/article-title-here/10?x=y
            getReplaceFormat: function (url) {
                var ret = '';
                var protocol = '';
                var protocolEnd = url.indexOf('://');
                if (protocolEnd >= 0) {
                    protocol = url.substring(0, protocolEnd + 3);
                    url = url.substring(protocolEnd + 3);
                }
                var parts = url.split('/');
                if (parts.length < 3) {
                    return '';
                }
                if (parts.length == 3) { // nothing after the article title
                    return (protocol ? protocol : 'http://') + url + '/{0}';
                }
                if (parts.length == 4 && parts[3] == '') { // nothing after title, trailing slash
                    return (protocol ? protocol : 'http://') + url + '{0}';
                }
                var pageRegExp = /^([0-9]*)((?:\?.*)|(?:#.*))?/i;
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
            articleMeatSelector: '.content > *:not(aside):not(.pagination):not(.rrssb-holder)',
            isLastPage: function (responseText) {
                return false;
            },
            isPastLastPage: function (responseText) {
                // If there isn't a 'Next' button, or there is one with text 'Next Article',
                // we've past the last page
                var html = $.parseHTML(responseText);
                var nextDiv = $(html).find('.pagination .next');
                return (nextDiv.length && (nextDiv[0].innerText).indexOf('Article') >= 0); // this is the junky page before next article
            },
            loadAll: function (thisInfo, fullArticleContainer, url) {
                // Function to execute after retrieving all of the article content
                var afterLastPage = function (pageNum) {
                    fullArticleContainer.addClass('content');
                    // Done - get the appropriate element on the page and replace it with 
                    // the element that we created.
                    replaceDOMElements('article.content', fullArticleContainer[0].outerHTML, function (msg) {
                        if (msg && msg.success) {
                            displayResult('Loaded ' + (pageNum) + ' pages');
                        }
                        else {
                            displayResult(GENERIC_ERROR);
                        }
                    });
                }

                // Recursively retrieve pages of article until the last one
                var urlFormat = thisInfo.getReplaceFormat(url);
                var addPage = function (pageNum) {
                    httpGet(urlFormat.format(pageNum), function (responseText) {
                        // Get the meat of the article and append it to our fullArticleContainer element
                        var html = $.parseHTML(responseText);
                        if (thisInfo.isPastLastPage(responseText)) {
                            afterLastPage(pageNum);
                        }
                        else {
                            if (pageNum > 1) {
                                thisInfo.articleMeatSelector += ':not(h1)'; // don't show the title more than once
                            }
                            var articleMeat = $(html).find(thisInfo.articleMeatSelector);
                            fullArticleContainer.append(articleMeat);

                            // Examine the page.  If it's the last one, add the elements to the page;
                            // otherwise, keep going.
                            if (thisInfo.isLastPage(responseText)) {
                                afterLastPage(pageNum);
                            }
                            else {
                                addPage(pageNum + 1);
                            }
                        }

                    });
                }
                addPage(1);
            }
        },

        "lifebuzz.com": {
            // Example URLs:
            // http://www.lifebuzz.com/article-title-here
            // http://www.lifebuzz.com/article-title-here/
            // http://www.lifebuzz.com/article-title-here/10
            // http://www.lifebuzz.com/article-title-here/10/
            // http://www.lifebuzz.com/article-title-here/10#something
            // http://www.lifebuzz.com/article-title-here/10/?x=y
            getReplaceFormat: function (url) {
                var ret = '';
                var protocol = '';
                var protocolEnd = url.indexOf('://');
                if (protocolEnd >= 0) {
                    protocol = url.substring(0, protocolEnd + 3);
                    url = url.substring(protocolEnd + 3);
                }
                var parts = url.split('/');
                if (parts.length < 2) {
                    return '';
                }
                if (parts.length == 2) { // nothing after the article title
                    return (protocol ? protocol : 'http://') + url + '/{0}';
                }
                if (parts.length == 3 && parts[2] == '') { // nothing after title, trailing slash
                    return (protocol ? protocol : 'http://') + url + '{0}';
                }
                var pageRegExp = /^([0-9]*)((?:\?.*)|(?:#.*))?/i;
                var matches = parts[2].match(pageRegExp);
                if (!matches || matches.length < 1) {
                    renderStatus('Invalid URL format :(');
                }
                // Reconstruct URL - start with 1 because 0 is the full match
                ret = (protocol ? protocol : 'http://') + parts[0] + '/' + parts[1] + '/';
                for (var i = 1; i < matches.length; i++) {
                    if (matches[i] == null)
                        continue;
                    if (i == 1)
                        ret += '{0}';
                    else
                        ret += matches[i];
                }
                return ret;
            },
            articleMeatSelector: '.single > *:not(#desktop-below-post-trending)',
            isLastPage: function (responseText) {
                // If there isn't a 'Next' button, or there is one that links to '/t/end-gallery',
                // this is the last page
                var html = $.parseHTML(responseText);
                var nextLink = $(html).find('a.next-post');
                return (nextLink.length);
            },
            loadAll: function (thisInfo, fullArticleContainer, url) {
                // Recursively retrieve pages of article until the last one
                var urlFormat = thisInfo.getReplaceFormat(url);
                var addPage = function (pageNum) {;
                    httpGet(urlFormat.format(pageNum), function (responseText) {
                        // Get the meat of the article and append it to our fullArticleContainer element
                        var html = $.parseHTML(responseText);
                        var articleMeat = $(html).find(thisInfo.articleMeatSelector);
                        articleMeat.find('img.lazy').each(function (index, listItem) {
                            $(listItem).attr('src', $(listItem).attr('data-original'));
                        });
                        fullArticleContainer.append(articleMeat);

                        // Examine the page.  If it's the last one, add the elements to the page;
                        // otherwise, keep going.
                        if (thisInfo.isLastPage(responseText)) {
                            // Done - get the appropriate element on the page and replace it with 
                            // the element that we created.
                            fullArticleContainer.addClass('single');
                            fullArticleContainer.find('.post-pagination').addClass('hidden');
                            fullArticleContainer.find('.share-bar').addClass('hidden');
                            replaceDOMElements('.single', fullArticleContainer[0].outerHTML, function (msg) {
                                if (msg && msg.success) {
                                    displayResult('Loaded ' + (pageNum) + ' pages');
                                }
                                else {
                                    displayResult(GENERIC_ERROR);
                                }
                            });
                        }
                        else {
                            addPage(pageNum + 1);
                        }
                    });
                }
                addPage(1);
            }
        }
    }

    // minq.com has the same format as suggest.com (wat)
    sites['minq.com'] = sites['suggest.com'];

    return sites;
}

/**
 * Display status in popup.
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
 * Show status, hide the loading 'spinner', and reenable the button.
 */
function displayResult(message, reenableButton) {
    renderStatus(message);
    $('.spinner').addClass('hidden');
    if (reenableButton) {
        $('#depaginateBtn').removeAttr('disabled');
    }
}

/**
 * Get sites supported by http://www.deslide.clusterfake.net.
 * 
 * The dictionary is indexed by the whatever.whatever format I use, and the values are the format
 * that deslide recognizes.  If these are different, I'll add the handler=NAME parameter when I
 * construct the link.
 * 
 * TODO: I think I'll have to improve my regex that extracts the whatever.whatever in order to 
 * properly recognize the wildcards.
 */
function getDeslideSupportedSites() {
    return { 
        'about.com': '*.about.com',
        'accessatlanta.com': '*.accessatlanta.com',
        'answers.com': '*.answers.com',
        'aol.com': '*.aol.com',
        'askmen.com': '*.askmen.com',
        'bleacherreport.com': '*.bleacherreport.com',
        'cafemom.com': '*.cafemom.com',
        'cbslocal.com': '*.cbslocal.com',
        'cnn.com': '*.cnn.com',
        'competitor.com': '*.competitor.com',
        'complex.com': '*.complex.com',
        'egotastic.com': '*.egotastic.com',
        'eonline.com': '*.eonline.com',
        'ew.com': '*.ew.com',
        'fark.com': '*.fark.com',
        'forbes.com': '*.forbes.com',
        'howstuffworks.com': '*.howstuffworks.com',
        'ibtimes.com': '*.ibtimes.com',
        'imageshack.us': '*.imageshack.us',
        'instyle.com': '*.instyle.com',
        'latimes.com': '*.latimes.com',
        'likes.com': '*.likes.com',
        'mercurynews.com': '*.mercurynews.com',
        'metromix.com': '*.metromix.com',
        'msn.com': '*.msn.com',
        'nymag.com': '*.nymag.com',
        'nytimes.com': '*.nytimes.com',
        'omaha.com': '*.omaha.com',
        'photobucket.com': '*.photobucket.com',
        'reuters.com': '*.reuters.com',
        'seriouseats.com': '*.seriouseats.com',
        'sfgate.com': '*.sfgate.com',
        'slate.com': '*.slate.com',
        'talkingpointsmemo.com': '*.talkingpointsmemo.com',
        'theglobeandmail.com': '*.theglobeandmail.com',
        'time.com': '*.time.com',
        'topix.com': '*.topix.com',
        'uproxx.com': '*.uproxx.com',
        'viralnova.com': '*.viralnova.com',
        'wtnh.com': '*.wtnh.com',
        'yahoo.com': '*.yahoo.com',
        'diply.com': '*diply.com',
        'wildammo.com': '*wildammo.com',
        //' ': 'Coppermine galleries', // huh?
        'abcnews.go.com': 'abcnews.go.com', 
        'espn.go.com': 'espn.go.com',
        'all-that-is-interesting.com': 'all-that-is-interesting.com',
        'animal.discovery.com': 'animal.discovery.com',
        'arstechnica.com': 'arstechnica.com',
        'austin.culturemap.com': 'austin.culturemap.com',
        'blastr.com': 'blastr.com',
        'blog.chron.com': 'blog.chron.com',
        'blog.laptopmag.com': 'blog.laptopmag.com',
        'blog.makezine.com': 'blog.makezine.com',
        'blog.moviefone.com': 'blog.moviefone.com',
        'blog.seattlepi.com': 'blog.seattlepi.com',
        'blog.timesunion.com': 'blog.timesunion.com',
        'blog.amctv.com': 'blogs.amctv.com',
        'blog.laweekly.com': 'blogs.laweekly.com',
        'bossip.com': 'bossip.com',
        'boston.com': 'boston.com',
        'thestreet.com': 'business-news.thestreet.com',
        'bustedcoverage.com': 'bustedcoverage.com',
        'buzzlie.com': 'buzzlie.com',
        'celebritytoob.com': 'celebritytoob.com',
        'celebuzz.com': 'celebslam.celebuzz.com',
        'coed.com': 'coed.com',
        'coedmagazine.com': 'coedmagazine.com',
        'collegecandy.com': 'collegecandy.com',
        'kiplinger.com': 'content.kiplinger.com',
        'dailycaller.ca': 'dailycaller.ca',
        'dailycaller.com': 'dailycaller.com',
        'dailysanctuary.com': 'dailysanctuary.com',
        'dallas.culturemap.com': 'dallas.culturemap.com',
        'darkroom.baltimoresun.com': 'darkroom.baltimoresun.com',
        'deadspin.com': 'deadspin.com',
        'definition.org': 'definition.org',
        'diffuser.fm': 'diffuser.fm',
        'dvice.com': 'dvice.com',
        'einestages.spiegel.de': 'einestages.spiegel.de',
        'emgn.com': 'emgn.com',
        'empireonline.com': 'empireonline.com',
        'english.caixin.com': 'english.caixin.com', 
        'fansided.com': 'fansided.com',
        'fashion.telegraph.co.uk': 'fashion.telegraph.co.uk',
        'firstwefeast.com': 'firstwefeast.com',
        'flavorwire.com': 'flavorwire.com',
        'fu-berlin.de': 'fu-berlin.de',
        'funnie.st': 'funnie.st',
        'gamedayr.com': 'gamedayr.com',
        'gamerant.com': 'gamerant.com',
        'gamingbolt.com': 'gamingbolt.com',
        'gawker.com': 'gawker.com', // Gawker Are Fucking Dead
        'gizmodo.com': 'gizmodo.com',
        'gothamist.com': 'gothamist.com',
        'guff.com': 'guff.com',
        'guyism.com': 'guyism.com',
        'hdden.com': 'hdden.com',
        'heavy.com': 'heavy.com',
        'heldendesalltags.net': 'heldendesalltags.net',
        'hollywoodlife.com': 'hollywoodlife.com',
        'houston.culturemap.com': 'houston.culturemap.com',
        'humorsignals.com': 'humorsignals.com',
        'idolator.com': 'idolator.com',
        'images.businessweek.com': 'images.businessweek.com',
        'imgur.com': 'imgur.com',
        'io9.com': 'io9.com',
        'jalopnik.com': 'jalopnik.com',
        'jezebel.com': 'jezebel.com',
        'juicyceleb.com': 'juicyceleb.com',
        'justviral.eu': 'justviral.eu',
        'kittentoob.com': 'kittentoob.com',
        'kotaku.com': 'kotaku.com',
        'lifehacker.com': 'lifehacker.com',
        'listcovery.com': 'listcovery.com',
        'lotsoflaughters.com': 'lotoflaughters.com',
        'm.n4g.com': 'm.n4g.com',
        'm.spiegel.de': 'm.spiegel.de',
        'madamenoire.com': 'madamenoire.com',
        'makezine.com': 'makezine.com',
        'mashable.com': 'mashable.com',
        'mediacenter.dailycamera.com': 'mediacenter.dailycamera.com',
        'mediagallery.usatoday.com': 'mediagallery.usatoday.com',
        'menify.com': 'menify.com',
        'mentalflare.com': 'mentalflare.com',
        'metv.com': 'metv.com',
        'mommynoire.com': 'mommynoire.com',
        'motherjones.com': 'motherjones.com',
        'moviesum.com': 'movieseum.com',
        'msn.foxsports.com': 'msn.foxsports.com',
        'myfox8.com': 'myfox8.com',
        'n4g.com': 'n4g.com',
        'natmonitor.com': 'natmonitor.com',
        'news.cincinnati.com': 'news.cincinnati.com',
        'news.cnet.com': 'news.cnet.com',
        'news.discovery.com': 'news.discovery.com',
        'news.moviefone.com': 'news.moviefone.com',
        'news.nationalgeographic.com': 'news.nationalgeographic.com',
        'news.xinhuanet.com': 'news.xinhuanet.com',
        'nflspinzone.com': 'nflspinzone.com',
        'noisey.vice.com': 'noisey.vice.com',
        'nypost.com': 'nypost.com',
        'opinion.people.com.cn': 'opinion.people.com.cn',
        'origin.wtsp.com': 'origin.wtsp.com',
        'perezhilton.com': 'perezhilton.com',
        'photos.caixin.com': 'photos.caixin.com',
        'photos.denverpost.com': 'photos.denverpost.com',
        'photos.ellen.warnerbros.com': 'photos.ellen.warnerbros.com',
        'photos.nj.com': 'photos.nj.com',
        'photos.pennlive.com': 'photos.pennlive.com',
        'photos.tmz.com': 'photos.tmz.com',
        'photos.toofab.com': 'photos.toofab.com',
        'picasaweb.google.com': 'picasaweb.google.com',
        'popnhop.com': 'popnhop.com',
        'puppytoob.com': 'puppytoob.com',
        'pyz.am': 'pyz.am',
        'radaronline.com': 'radaronline.com',
        'rantchic.com': 'rantchic.com',
        'regretfulmorning.com': 'regretfulmorning.com',
        'reviews.cnet.com': 'reviews.cnet.com',
        'ripbird.com': 'ripbird.com',
        'rottenpanda.com': 'rottenpanda.com',
        'runt-of-the-web.com': 'runt-of-the-web.com',
        'salary.com': 'salary.com',
        'screencrush.com': 'screencrush.com',
        'screenrant.com': 'screenrant.com',
        'seattletimes.com': 'seattletimes.com',
        'seattletimes.nwsource.com': 'seattletimes.nwsource.com',
        'shortlist.com': 'shortlist.com',
        'slideshow.nbcnews.com': 'slideshow.nbcnews.com',
        'slideshow.today.com': 'slideshow.today.com',
        'slideshows.collegehumor.com': 'slideshows.collegehumor.com',
        'socialitelife.com': 'socialitelife.com',
        'static.thefrisky.com': 'static.thefrisky.com',
        'story.wittyfeed.com': 'story.wittyfeed.com',
        'styleblazer.com': 'styleblazer.com',
        'sz-magazin.sueddeutsche.de': 'sz-magazin.sueddeutsche.de',
        'theblemish.com': 'theblemish.com',
        'thehill.com': 'thehill.com',
        'theweek.com': 'theweek.com',
        'thewire.co.uk': 'thewire.co.uk',
        'time.com': 'time.com',
        'travel.allwomenstalk.com': 'travel.allwomenstalk.com', // always wonder how to parse this - "all women's talk" or "all women stalk"??
        'twentytwowords.com': 'twentytwowords.com',
        'venturebeat.com': 'venturebeat.com',
        'viewmixed.com': 'viewmixed.com',
        'wallstcheatsheet.com': 'wallstcheatsheet.com',
        'whatculture.com': 'whatculture.com',
        'worldwideinterweb.com': 'worldwideinterweb.com',
        'worthly.com': 'worthly.com',
        'wtkr.com': 'wtkr.com',
        'wtvr.com': 'wtvr.com',
        '10best.com': 'www.10best.com',
        '123inspiration.com': 'www.123inspiration.com',
        '29-95.com': 'www.29-95.com',
        'aarp.org': 'www.aarp.org',
        'adweek.com': 'www.adweek.com',
        'ajc.com': 'www.ajc.com',
        'animalplanet.com': 'www.animalplanet.com',
        'aolnews.com': 'www.aolnews.com',
        'art-magazin.de': 'www.art-magazin.de',
        'autobild.de': 'www.autobild.de',
        'azcentral.com': 'www.azcentral.com',
        'azfamily.com': 'www.azfamily.com',
        'babble.com': 'www.babble.com',
        'baltimoresun.com': 'www.baltimoresun.com',
        'bankrate.com': 'www.bankrate.com',
        'bbc.co.uk': 'www.bbc.co.uk',
        'bbc.com': 'www.bbc.com',
        'belfasttelegraph.co.uk': 'www.belfasttelegraph.co.uk',
        'bellasugar.com': 'www.bellasugar.com',
        'berliner-zeitung.de': 'www.berliner-zeitung.de',
        'bild.de': 'www.bild.de',
        'bizjournals.com': 'www.bizjournals.com',
        'blastr.com': 'www.blastr.com',
        'bleedingcool.com': 'www.bleedingcool.com',
        'bloomberg.com': 'www.bloomberg.com',
        'bobvila.com': 'www.bobvila.com',
        'bonappetit.com': 'www.bonappetit.com',
        'boredlion.com': 'www.boredlion.com',
        'boston.com': 'www.boston.com',
        'bostonherald.com': 'www.bostonherald.com',
        'bracketsdaily.com': 'www.bracketsdaily.com',
        'brainjet.com': 'www.brainjet.com',
        'break.com': 'www.break.com',
        'brisbanetimes.com.au': 'www.brisbanetimes.com.au',
        'brobible.com': 'www.brobible.com', // ew
        'buddytv.com': 'www.buddytv.com',
        'businessinsider.com': 'www.businessinsider.com',
        'businessnewsdaily.com': 'www.businessnewsdaily.com',
        'bustle.com': 'www.bustle.com',
        'buzzfeed.com': 'www.buzzfeed.com',
        'buzzsugar.com': 'www.buzzsugar.com',
        'bytesized.me': 'www.bytesized.me',
        'canberratimes.com.au': 'www.canberratimes.com.au',
        'casasugar.com': 'www.casasugar.com',
        'cbc.ca': 'www.cbc.ca',
        'cbs.com': 'www.cbs.com',
        'cbsnews.com': 'www.cbsnews.com',
        'cbssports.com': 'www.cbssports.com',
        'celebritynetworth.com': 'www.celebritynetworth.com',
        'celebstyle.com': 'www.celebstyle.com',
        // ' ': 'www.celebuzz.com',
        'celebzen.com': 'www.celebzen.com',
        'celebzen.com.au': 'www.celebzen.com.au',
        'chacha.com': 'www.chacha.com',
        'cheatcc.com': 'www.cheatcc.com',
        'chicagotribune.com': 'www.chicagotribune.com',
        'chip.de': 'www.chip.de',
        'chron.com': 'www.chron.com',
        'cinemablend.com': 'www.cinemablend.com',
        'cio.com': 'www.cio.com',
        'classicfm.com': 'www.classicfm.com',
        'clickorlando.com': 'www.clickorlando.com',
        'cnbc.com': 'www.cnbc.com',
        'cntraveler.com': 'www.cntraveler.com',
        'collegehumor.com': 'www.collegehumor.com',
        'comicbookmovie.com': 'www.comicbookmovie.com',
        'complexmag.ca': 'www.complexmag.ca',
        'complexmag.com': 'www.complexmag.com',
        'computerworld.com': 'www.computerworld.com',
        'corriere.it': 'www.corriere.it',
        'cosmopolitan.co.uk': 'www.cosmopolitan.co.uk',
        'cosmopolitan.com ': 'www.cosmopolitan.com',
        'courant.com': 'www.courant.com',
        'cracked.com': 'www.cracked.com',
        'csmonitor.com': 'www.csmonitor.com',
        'csoonline.com': 'www.csoonline.com',
        'ctnow.com': 'www.ctnow.com',
        'dailyfunlists.com': 'www.dailyfunlists.com',
        'dailygazette.com': 'www.dailygazette.com',
        'dallasobserver.com': 'www.dallasobserver.com',
        'darkreading.com': 'www.darkreading.com',
        'daytondailynews.com': 'www.daytondailynews.com',
        'delish.com': 'www.delish.com',
        'designsponge.com': 'www.designsponge.com',
        'desmoinesregister.com': 'www.desmoinesregister.com',
        'digitalone.com.sg': 'www.digitalone.com.sg',
        'digitalspy.co.uk': 'www.digitalspy.co.uk',
        'digitalspy.com': 'www.digitalspy.com',
        'digitalspy.com.au': 'www.digitalspy.com.au',
        'dispatch.com': 'www.dispatch.com',
        'dorkly.com': 'www.dorkly.com',
        'ebaumsworld.com': 'www.ebaumsworld.com',
        'elle.com': 'www.elle.com',
        'empireonline.com': 'www.empireonline.com',
        'entertainmentwise.com': 'www.entertainmentwise.com',
        'environmentalgraffiti.com': 'www.environmentalgraffiti.com',
        'escapehere.com': 'www.escapehere.com',
        'esquire.com': 'www.esquire.com',
        'everyjoe.com': 'www.everyjoe.com',
        'eweek.com': 'www.eweek.com',
        'examiner.com': 'www.examiner.com',
        'fabsugar.com': 'www.fabsugar.com',
        'fame10.com': 'www.fame10.com',
        'fastcodesign.com': 'www.fastcodesign.com',
        'faz.net': 'www.faz.net',
        'fieldandstream.com': 'www.fieldandstream.com',
        'fitsugar.com': 'www.fitsugar.com',
        'flavorwire.com': 'www.flavorwire.com',
        'focus.de': 'www.focus.de',
        'food.com': 'www.food.com',
        'foodandwine.com': 'www.foodandwine.com',
        'footballnation.com': 'www.footballnation.com',
        'foreignpolicy.com': 'www.foreignpolicy.com',
        'fox2now.com': 'www.fox2now.com',
        'fox40.com': 'www.fox40.com',
        'fox59.com': 'www.fox59.com',
        'fox5sandiego.com': 'www.fox5sandiego.com',
        'foxnews.com': 'www.foxnews.com',
        'fr-online.de': 'www.fr-online.de',
        'gameranx.com': 'www.gameranx.com',
        'gamesblog.it': 'www.gamesblog.it',
        'gamespot.com': 'www.gamespot.com',
        'gamesradar.com': 'www.gamesradar.com',
        'geeksaresexy.net': 'www.geeksaresexy.net',
        'geeksugar.com': 'www.geeksugar.com',
        'gigwise.com': 'www.gigwise.com',
        'gizmopod.com': 'www.gizmopod.com',
        'golf.com': 'www.golf.com',
        'gq.com': 'www.gq.com',
        'grated.com': 'www.grated.com',
        'guardian.co.uk': 'www.guardian.co.uk',
        'haikudeck.com': 'www.haikudeck.com',
        'harpersbazaar.com': 'www.harpersbazaar.com',
        'health.com': 'www.health.com',
        'heise.de': 'www.heise.de',
        'hgtvremodels.com': 'www.hgtvremodels.com',
        'highrated.net': 'www.highrated.net',
        'hitfix.com': 'www.hitfix.com',
        'hlntv.com': 'www.hlntv.com',
        'hollyscoop.com': 'www.hollyscoop.com',
        'hollywood.com': 'www.hollywood.com',
        'hollywoodreporter.com': 'www.hollywoodreporter.com',
        'hollywoodtuna.com': 'www.hollywoodtuna.com',
        'houstonpress.com': 'www.houstonpress.com',
        'huffingtonpost.com': 'www.huffingtonpost.*', // TODO
        'idolator.com': 'www.idolator.com',
        'ign.com': 'www.ign.com',
        'imdb.com': 'www.imdb.com',
        'informationweek.com': 'www.informationweek.com',
        'infoworld.com': 'www.infoworld.com',
        'irishcentral.com': 'www.irishcentral.com',
        'itworld.com': 'www.itworld.com',
        'ivillage.com': 'www.ivillage.com',
        'kare11.com': 'www.kare11.com',
        'katu.com': 'www.katu.com',
        'kentucky.com': 'www.kentucky.com',
        'kicker.de': 'www.kicker.de',
        'killsometime.com': 'www.killsometime.com',
        'kiplinger.com': 'www.kiplinger.com',
        'kitv.com': 'www.kitv.com',
        'ktla.com': 'www.ktla.com',
        'ktvu.com': 'www.ktvu.com',
        'kvia.com': 'www.kvia.com',
        'laudable.com': 'www.laudable.com',
        'laweekly.com': 'www.laweekly.com',
        'life.com': 'www.life.com',
        'lifebuzz.com': 'www.lifebuzz.com',
        'lifedaily.com': 'www.lifedaily.com',
        'lifescript.com': 'www.lifescript.com',
        'lilsugar.com': 'www.lilsugar.com',
        'littlethings.com': 'www.littlethings.com',
        'livescience.com': 'www.livescience.com',
        'livestrong.com': 'www.livestrong.com',
        'local10.com': 'www.local10.com',
        'london2012.com': 'www.london2012.com',
        'makezine.com': 'www.makezine.com',
        'mandatory.com': 'www.mandatory.com',
        'marketwatch.com': 'www.marketwatch.com',
        'mcall.com': 'www.mcall.com',
        'menshealth.com': 'www.menshealth.com',
        'miamiherald.com': 'www.miamiherald.com',
        'mirror.co.uk': 'www.mirror.co.uk',
        'mlive.com': 'www.mlive.com',
        'mnn.com': 'www.mnn.com',
        'monopol-magazin.de': 'www.monopol-magazin.de',
        'motherjones.com': 'www.motherjones.com',
        'myfox8.com': 'www.myfox8.com',
        'myhealthnewsdaily.com': 'www.myhealthnewsdaily.com',
        'mysanantonio.com': 'www.mysanantonio.com',
        'nationaltimes.com.au': 'www.nationaltimes.com.au',
        'nba.com': 'www.nba.com',
        'nbc.com': 'www.nbc*', // TODO
        'nbcnews.com': 'www.nbcnews.com',
        'networkworld.com': 'www.networkworld.com',
        'neverunderdressed.com': 'www.neverunderdressed.com',
        'news800.com': 'www.news800.com',
        'newsarama.com': 'www.newsarama.com',
        'newser.com': 'www.newser.com',
        'newstimes.com': 'www.newstimes.com',
        'newyorker.com': 'www.newyorker.com',
        'nfl.com': 'www.nfl.com',
        'ngz-online.de': 'www.ngz-online.de',
        'nj.com': 'www.nj.com',
        'nme.com': 'www.nme.com',
        'notsafeforwhat.com': 'www.notsafeforwhat.com',
        'npr.org': 'www.npr.org',
        'nsmbl.nl': 'www.nsmbl.nl',
        'numberfire.com': 'www.numberfire.com',
        'nuts.co.uk': 'www.nuts.co.uk',
        'nydailynews.com': 'www.nydailynews.com',
        'nypost.com': 'www.nypost.com',
        'ocregister.com': 'www.ocregister.com',
        'ocweekly.com': 'www.ocweekly.com',
        'officialplaystationmagazine.co.uk': 'www.officialplaystationmagazine.co.uk',
        'omghacks.com': 'www.omghacks.com',
        'opposingviews.com': 'www.opposingviews.com',
        'oregonlive.com': 'www.oregonlive.com',
        'orlandosentinel.com': 'www.orlandosentinel.com',
        'ouramazingplanet.com': 'www.ouramazingplanet.com',
        'parenting.com': 'www.parenting.com',
        'parents.com': 'www.parents.com',
        'parentsociety.com': 'www.parentsociety.com',
        'pcgamer.com': 'www.pcgamer.com',
        'pcmag.com': 'www.pcmag.com',
        'pcworld.com': 'www.pcworld.com',
        'people.com': 'www.people.com',
        'peoplepets.com': 'www.peoplepets.com',
        'peoplestylewatch.com': 'www.peoplestylewatch.com',
        'petsugar.com': 'www.petsugar.com',
        'philly.com': 'www.philly.com',
        'phoenixnewtimes.com': 'www.phoenixnewtimes.com',
        'politico.com': 'www.politico.com',
        'popcrunch.com': 'www.popcrunch.com',
        'popsci.com': 'www.popsci.com',
        'popsugar.com': 'www.popsugar.com',
        'popularmechanics.com': 'www.popularmechanics.com',
        'press-citizen.com': 'www.press-citizen.com',
        'pressroomvip.com': 'www.pressroomvip.com',
        'q13fox.com': 'www.q13fox.com',
        'ranker.com': 'www.ranker.com',
        'rantchic.com': 'www.rantchic.com',
        'rantfood.com': 'www.rantfood.com',
        'rantlifestyle.com': 'www.rantlifestyle.com',
        'rantsports.com': 'www.rantsports.com',
        'rd.com': 'www.rd.com',
        'readersdigest.ca': 'www.readersdigest.ca',
        'realclearscience.com': 'www.realclearscience.com',
        'realclearworld.com': 'www.realclearworld.com',
        'realsimple.com': 'www.realsimple.com',
        'realtor.com': 'www.realtor.com',
        'rebelcircus.com': 'www.rebelcircus.com',
        'redeyechicago.com': 'www.redeyechicago.com',
        'refinedguy.com': 'www.refinedguy.com',
        'refinery29.com': 'www.refinery29.com',
        'repubblica.it': 'www.repubblica.it',
        'riverfronttimes.com': 'www.riverfronttimes.com',
        'roasted.com': 'www.roasted.com',
        'rollingstone.com': 'www.rollingstone.com',
        'rottenpanda.com': 'www.rottenpanda.com',
        'rottentomatoes.com': 'www.rottentomatoes.com',
        'rp-online.de': 'www.rp-online.de',
        'rsvlts.com': 'www.rsvlts.com',
        // 'salary.com': 'www.salary.com',
        'salon.com': 'www.salon.com',
        'savvysugar.com': 'www.savvysugar.com',
        'seattlepi.com': 'www.seattlepi.com',
        'seattleweekly.com': 'www.seattleweekly.com',
        'sfweekly.com': 'www.sfweekly.com',
        'sfx.co.uk': 'www.sfx.co.uk',
        'shape.com': 'www.shape.com',
        'shebudgets.com': 'www.shebudgets.com',
        'shefinds.com': 'www.shefinds.com',
        'shortlist.com': 'www.shortlist.com',
        'si.com': 'www.si.com',
        'slideshare.net': 'www.slideshare.net',
        'sltrib.com': 'www.sltrib.com',
        'smh.com.au': 'www.smh.com.au',
        'smithsonianmag.com': 'www.smithsonianmag.com',
        'snakkle.com': 'www.snakkle.com',
        'southernliving.com': 'www.southernliving.com',
        'space.com': 'www.space.com',
        'spiegel.de': 'www.spiegel.de',
        'spin.com': 'www.spin.com',
        'sportal.de': 'www.sportal.de',
        'sportsradiokjr.com': 'www.sportsradiokjr.com',
        'stamfordadvocate.com': 'www.stamfordadvocate.com',
        'star-telegram.com': 'www.star-telegram.com',
        'starpulse.com': 'www.starpulse.com',
        'stereogum.com': 'www.stereogum.com',
        'stereotude.com': 'www.stereotude.com',
        'stern.de': 'www.stern.de',
        'stuff.co.nz': 'www.stuff.co.nz',
        'stuffyoushouldknow.com': 'www.stuffyoushouldknow.com',
        'stylebistro.com': 'www.stylebistro.com',
        'stylelist.com': 'www.stylelist.com',
        'stylist.co.uk': 'www.stylist.co.uk',
        'sueddeutsche.de': 'www.sueddeutsche.de',
        'suggest.com': 'www.suggest.com',
        'sun-sentinel.com': 'www.sun-sentinel.com',
        'tagesschau.de': 'www.tagesschau.de',
        'tagesspiegel.de': 'www.tagesspiegel.de',
        'takepart.com': 'www.takepart.com',
        'techconnect.com': 'www.techconnect.com',
        'technewsdaily.com': 'www.technewsdaily.com',
        'techradar.com': 'www.techradar.com',
        'techrepublic.com': 'www.techrepublic.com',
        'techworld.com.au': 'www.techworld.com.au',
        'telegraph.co.uk': 'www.telegraph.co.uk',
        'theage.com.au': 'www.theage.com.au',
        'theatlantic.com': 'www.theatlantic.com',
        'thedailybeast.com': 'www.thedailybeast.com',
        'thedailymeal.com': 'www.thedailymeal.com',
        'thefiscaltimes.com': 'www.thefiscaltimes.com',
        'thefrisky.com': 'www.thefrisky.com',
        'thefumble.com': 'www.thefumble.com',
        'theguardian.com': 'www.theguardian.com',
        'theleek.com': 'www.theleek.com',
        'thelocal.com': 'www.thelocal.*', // TODO
        'theonion.com': 'www.theonion.com',
        'thepostgame.com': 'www.thepostgame.com',
        'therichest.com': 'www.therichest.com',
        'thesmokinggun.com': 'www.thesmokinggun.com',
        'thestreet.com': 'www.thestreet.com',
        'thesun.co.uk': 'www.thesun.co.uk',
        'thesuperficial.com': 'www.thesuperficial.com',
        'thevine.com.au': 'www.thevine.com.au',
        'thewrap.com': 'www.thewrap.com',
        'thinkadvisor.com': 'www.thinkadvisor.com',
        'thisoldhouse.com': 'www.thisoldhouse.com',
        'tmz.com': 'www.tmz.com',
        'today.com': 'www.today.com',
        'tomorrowoman.com': 'www.tomorrowoman.com',
        'tomsguide.com': 'www.tomsguide.com',
        'tomshardware.com': 'www.tomshardware.com',
        'topgear.com': 'www.topgear.com',
        'torontosun.com': 'www.torontosun.com',
        'totalfilm.com': 'www.totalfilm.com',
        'totalprosports.com': 'www.totalprosports.com',
        'travelandleisure.com': 'www.travelandleisure.com',
        'treehugger.com': 'www.treehugger.com',
        'tressugar.com': 'www.tressugar.com',
        'trutv.com': 'www.trutv.com',
        'tvguide.com': 'www.tvguide.com',
        'tvovermind.com': 'www.tvovermind.com',
        'upi.com': 'www.upi.com',
        'usmagazine.com': 'www.usmagazine.com',
        'usnews.com': 'www.usnews.com',
        'vanityfair.com': 'www.vanityfair.com',
        'vg247.com': 'www.vg247.com',
        'vh1.com': 'www.vh1.com',
        'vice.com': 'www.vice.com',
        'villagevoice.com': 'www.villagevoice.com',
        'viralands.com': 'www.viralands.com',
        'vulture.com': 'www.vulture.com',
        'washingtonpost.com': 'www.washingtonpost.com',
        'watoday.com.au': 'www.watoday.com.au',
        'wbaltv.com': 'www.wbaltv.com',
        'wcvb.com': 'www.wcvb.com',
        'weather.com': 'www.weather.com',
        'weblyest.com': 'www.weblyest.com',
        'welt.de': 'www.welt.de',
        'wesh.com': 'www.wesh.com',
        'westworld.com': 'www.westword.com',
        'wftv.com': 'www.wftv.com',
        'wgal.com': 'www.wgal.com',
        'whas11.com': 'www.whas11.com',
        'wholeliving.com': 'www.wholeliving.com',
        'wired.co.uk': 'www.wired.co.uk',
        'wired.com': 'www.wired.com',
        'wisn.com': 'www.wisn.com',
        'wittyfeed.com': 'www.wittyfeed.com',
        'wlac.com': 'www.wlac.com',
        'wlsam.com': 'www.wlsam.com',
        'wlwt.com': 'www.wlwt.com',
        'wmtw.com': 'www.wmtw.com',
        'wowthatscool.com': 'www.wowthatscool.com',
        'wpix.com': 'www.wpix.com',
        'wptv.com': 'www.wptv.com',
        'wsbtv.com': 'www.wsbtv.com',
        'wtae.com': 'www.wtae.com',
        'wtkr.com': 'www.wtkr.com',
        'wtsp.com': 'www.wtsp.com',
        'wusa9.com': 'www.wusa9.com',
        'wwe.com': 'www.wwe.com',
        'wwtdd.com': 'www.wwtdd.com',
        'yumsugar.com': 'www.yumsugar.com',
        'zagat.com': 'www.zagat.com',
        'zap2it.com': 'www.zap2it.com',
        'zdnet.com': 'www.zdnet.com',
        'zeit.de': 'www.zeit.de',
        'zimbio.com': 'www.zimbio.com',
        'www2.tbo.com': 'www2.tbo.com',
        'xfinity.comcast.net': 'xfinity.comcast.net',
        'xhamster.com': 'xhamster.com' // not sure about this one
    };
}