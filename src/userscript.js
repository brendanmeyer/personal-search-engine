// ==UserScript==
// @name         personal-search-engine
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  collect website content from daily web surfing
// @author       Beeno Tung
// @include      http://*
// @include      https://*
// @grant        none
// ==/UserScript==

;(function () {
  'use strict';

  console.log('personal-search-engine v0.1');

  console.log(fetch);
  console.log(fetch.Headers);
  console.log(undefined === fetch.Headers);
  if (undefined === fetch.Headers) {
    if (!window._pseFetch) {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe); // add element
      window._pseFetch = iframe.contentWindow.fetch;
    }
  } else {
    window._pseFetch = window.fetch
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
  }

  let api_origin = 'http://localhost:8090';

  let skipURIList = [
    "https?://.*?:8090",
  ];

  // console.log(location.origin)
  for (let i = 0; i < skipURIList.length; i++) {
    let uriMatch = skipURIList[i];
    var re = new RegExp(uriMatch, "i");
    // console.log(uriMatch, re.test(location.origin));
    if(re.test(location.origin)) {
      // console.log("page not recorded")
      return;
    }
  }

  let blockedByCSP = false;
  let retryBackoff = 5000;

  let skipMetaNameList = ['regionsAllowed', /:url/];
  let urlMatchSkipSelectorList = [
    [/.*/, [
        'svg',
        'script',
        'iframe',
        'link',
        'style',
        '.TridactylStatusIndicator',
        'noscript',
      ]
    ],
    [/https:\/\/www\.youtube\.com\/watch\?/, ['.playlist-items', '#related']],
  ];
  let skipParamNameList = [
    [/.*/, [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        // 'utm_term',
        'utm_content',
      ]
    ],
    [/https:\/\/www\.youtube\.com\/watch\?/, ['list','index','t']],
  ];

  function getCurrentUrl() {
    let search = location.search;
    if (search) {
      let params = new URLSearchParams(search);
      skipParamNameList.forEach(
        ([urlMatch, paramNameList]) =>
        (
          location.href.match(urlMatch) &&
          paramNameList.forEach(paramName => params.delete(paramName))
        )
      );
      // skipParamNameList.forEach(name => params.delete(name))
      return (
        location.origin +
        location.pathname +
        '?' +
        params.toString() +
        location.hash
      );
    }
    return location.href;
  }

  function compare(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  let initialUrl = location.href;

  function main() {
    let meta_list = [];
    document
      .querySelectorAll(
        // the meta in body of youtube won't update when switching to other videos with client-side routing
        initialUrl === location.href ? 'meta[content]' : 'body meta[content]',
      )
      .forEach((meta, index) => {
        attr: for (let i = 0; i < meta.attributes.length; i++) {
          let attr = meta.attributes.item(i);
          if (attr.nodeName === 'content') continue;
          let key = attr.nodeValue;
          for (let skipName of skipMetaNameList) {
            if (key.match(skipName)) {
              continue attr;
            }
          }
          let type = attr.nodeName;
          let value = meta.attributes.getNamedItem('content').nodeValue;
          meta_list.push({ index, type, key, value });
        }
      });
    meta_list = meta_list
      .sort((a, b) => compare(a.value, b.value) || compare(a.index, b.index))
      .filter((x, i, xs) => i === 0 || x.value !== xs[i - 1].value)
      .sort((a, b) => compare(a.index, b.index))
      .map(meta => {
        delete meta.index;
        return meta;
      });

    let body = document.createElement('body');
    body.innerHTML = document.body.innerHTML;

    urlMatchSkipSelectorList.forEach(
      ([urlMatch, selectorList]) =>
        location.href.match(urlMatch) &&
        selectorList.forEach(selector =>
          body.querySelectorAll(selector).forEach(e => e.remove()),
        ),
    );
    if (location.href.startsWith('')) {
      body.querySelectorAll('.playlist-items');('#related');
    }
    body.querySelectorAll('*').forEach(e => {
      let styles = getComputedStyle(e);
      if (styles.display === 'none') {
        e.remove();
        return;
      }
      if (e.tagName === 'IMG' && e.alt) {
        e.outerHTML = `<span>${e.alt}</span>`;
        return;
      }
      if (!e.textContent.trim()) {
        e.remove();
        return;
      }
    });
    let text = Array.from(
      new Set(
        body.textContent
          .split('\n')
          .map(line => line.trim())
          .filter(line => line),
      ),
    ).join('\n');

    let title = document.title;
    let url = getCurrentUrl();
    let page = {
      url,
      title,
      meta_list,
      text,
    };

    // console.log("main()")
    // console.log(url)
    for (let i = 0; i < skipURIList.length; i++) {
      let uriMatch = skipURIList[i];
      var re = new RegExp(uriMatch, "i");
      // console.log(uriMatch, re.test(url));
      if(re.test(url)) {
        // console.log("page not recorded");
        return;
      }
    }

    console.log('report page:', {
      title,
      url,
      text_length: text.length,
    });
    function upload() {
      if (blockedByCSP) return;
      window._pseFetch(api_origin + '/page', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page }),
      }).catch(error => {
        console.error('failed to post page:', error);
        setTimeout(
          () =>
            window._pseFetch('/', { method: 'HEAD' })
              .then(res => {
                let policy = res.headers.get('content-security-policy');
                if (policy && policy.includes('connect-src')) {
                  blockedByCSP = true;
                  return;
                }
              })
              .catch(error => {
                console.error('failed to check CSP:', error);
              })
              .then(() => {
                if (blockedByCSP) return;
                setTimeout(() => {
                  retryBackoff *= 1.5;
                  requestIdleCallback(upload);
                }, retryBackoff);
              }),
          retryBackoff,
        );
      });
    }
    requestIdleCallback(upload);
  };

  let lastUrl = null;
  let lastTitle = null;

  function wait(acc, url) {
    if (url !== location.href) {
      // call start() just in case popstate and hashchange is not triggered
      // e.g. when switch video in youtube
      start();
      return;
    }
    // console.log('wait:', acc)
    if (acc <= 0) {
      main();
      return;
    }
    requestIdleCallback(() => wait(acc - 1, url));
  }

  function start(event) {
    // console.log(lastUrl, location.href, lastTitle, document.title);
    if (lastUrl === location.href && lastTitle === document.title) return;

    lastUrl = location.href;
    lastTitle = document.title;
    console.log('start from:', event);
    wait(20, lastUrl);
  }

  window.addEventListener('popstate', start);
  window.addEventListener('hashchange', start);
  new MutationObserver(mutations => {
    start('dom mutation');
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  start('init');
})();