// ==UserScript==
// @name         NCIC ↔ NC SOS Owner Capture
// @namespace    mci-tools
// @version      2.0
// @description  From NCIC app: click SOS → open SOS search, prefill business name, auto-search. On SOS profile page: scrape owner/agent + address and POST back to NCIC /api/sos_officials. Includes ON/OFF toggle via custom event.
// @match        http://localhost:5000/*
// @match        http://127.0.0.1:5000/*
// @match        http://192.168.1.203:5000/*
// @match        https://www.sosnc.gov/online_services/search/by_title/search_Business_Registration*
// @match        https://www.sosnc.gov/online_services/search/Business_Registration_Results*
// @match        https://www.sosnc.gov/online_services/search/Business_Registration_profile/*
// @match        https://www.sosnc.gov/online_services/search/profile_filings/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      localhost
// @connect      127.0.0.1
// @connect      192.168.1.203
// @connect      www.sosnc.gov
// @updateURL    https://raw.githubusercontent.com/Synth6/Tamper-Monkey-V2/main/NCIC%20%E2%86%94%20NC%20SOS%20Owner%20Capture.user.js
// @downloadURL  https://raw.githubusercontent.com/Synth6/Tamper-Monkey-V2/main/NCIC%20%E2%86%94%20NC%20SOS%20Owner%20Capture.user.js
// ==/UserScript==

(function () {
  'use strict';

  const href = location.href;
  const host = location.hostname;
  const port = location.port;

  const LAST_NAME_KEY = 'ncic_last_business_name';
  const LAST_BASE_KEY = 'ncic_last_base_url';
  const LAST_TARGET_KEY = 'ncic_last_target_key';
  const REFRESH_TOKEN_KEY = 'ncic_refresh_token';
  const ENABLE_KEY = 'ncic_sos_owner_capture_enabled';

  function log() {
    const args = Array.prototype.slice.call(arguments);
    args.unshift('[NCIC SOS]');
    console.log.apply(console, args);
  }

  function clean(s) {
    return (s || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  function escapeRegex(s) {
    return (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isFooterJunkLine(line) {
    const s = clean(line || '');
    if (!s) return true;

    return /^(return to top|other agencies|secretary of state|home|contact us|back|search|online services)$/i.test(s) ||
          /\b(return to top|other agencies|secretary of state|contact us|online services)\b/i.test(s);
  }

  function cleanAddressValue(value) {
    let s = clean(value || '');
    if (!s) return '';

    s = s.replace(/\bReturn to top\b.*$/i, '');
    s = s.replace(/\bOther Agencies\b.*$/i, '');
    s = s.replace(/\bSecretary of State\b.*$/i, '');
    s = s.replace(/\bOnline Services\b.*$/i, '');
    s = s.replace(/\s*,\s*,+/g, ', ');
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/[,\s]+$/, '');

    return s;
  }

  async function isEnabled() {
    return await GM_getValue(ENABLE_KEY, true);
  }

  async function setEnabled(v) {
    await GM_setValue(ENABLE_KEY, !!v);
  }

  function updateToggleButtonUI(on) {
    const btn = document.getElementById('ncic-sos-toggle');
    if (!btn) return;
    btn.textContent = on ? 'SOS Capture: ON' : 'SOS Capture: OFF';
    btn.style.background = on ? '#16a34a' : '#dc2626';
    btn.style.color = '#fff';
    btn.style.border = '0';
    btn.style.padding = '6px 10px';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      console.warn('[NCIC SOS] Copy failed', e);
    }
    document.body.removeChild(ta);
  }

  function copyToClipboard(text) {
    if (!text) return;
    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  const isNcicApp =
    port === '5000' &&
    (host === 'localhost' || host === '127.0.0.1' || host === '192.168.1.203');

  const isSosSearch =
    host === 'www.sosnc.gov' &&
    href.indexOf('https://www.sosnc.gov/online_services/search/by_title/search_Business_Registration') === 0;

  const isSosResults =
    host === 'www.sosnc.gov' &&
    href.indexOf('https://www.sosnc.gov/online_services/search/Business_Registration_Results') === 0;

  const isSosProfile =
    host === 'www.sosnc.gov' &&
    href.indexOf('https://www.sosnc.gov/online_services/search/Business_Registration_profile/') === 0;

  const isSosFilings =
    host === 'www.sosnc.gov' &&
    href.indexOf('https://www.sosnc.gov/online_services/search/profile_filings/') === 0;

  function textOf(el) {
    if (!el) return '';
    return clean(el.innerText || el.textContent || '');
  }

  function looksLikeLabelOnlyText(elText, labelText) {
    const a = clean(elText).replace(/:$/, '').toLowerCase();
    const b = clean(labelText).replace(/:$/, '').toLowerCase();
    return a === b;
  }

  function getValueAfterLabel(labelText) {
    const all = Array.prototype.slice.call(document.querySelectorAll('strong,b,span,div,p,dt,td,th,h1,h2,h3,h4,h5,h6,label'));
    let i, el, txt, next, parentText, after;

    for (i = 0; i < all.length; i++) {
      el = all[i];
      txt = textOf(el);

      if (!txt) continue;

      if (looksLikeLabelOnlyText(txt, labelText)) {
        next = el.nextElementSibling;
        if (next) {
          txt = textOf(next);
          if (txt) return txt;
        }

        if (el.parentElement) {
          parentText = textOf(el.parentElement);
          if (parentText && parentText.toLowerCase().indexOf(clean(labelText).toLowerCase()) === 0) {
            after = clean(parentText.substring(clean(labelText).length).replace(/^:/, ''));
            if (after) return after;
          }
        }
      }

      if (txt.toLowerCase().indexOf(clean(labelText).toLowerCase() + ':') === 0) {
        after = clean(txt.substring((clean(labelText) + ':').length));
        if (after) return after;
      }
    }

    const bodyText = textOf(document.body);
    const escaped = escapeRegex(clean(labelText));
    const re = new RegExp(escaped + '\\s*:?\\s*([^\\n]+)', 'i');
    const m = bodyText.match(re);
    return m ? clean(m[1]) : '';
  }

  function getBlockAfterHeader(headerText) {
    const all = Array.prototype.slice.call(
      document.querySelectorAll('strong,b,div,p,h1,h2,h3,h4,h5,h6,span,td,th,dt')
    );
    let i, el, txt, cur, lines;

    for (i = 0; i < all.length; i++) {
      el = all[i];
      txt = textOf(el);
      if (!txt) continue;

      if (looksLikeLabelOnlyText(txt, headerText) || txt.toLowerCase() === clean(headerText).toLowerCase() + ':') {
        lines = [];
        cur = el.nextElementSibling;

        while (cur && lines.length < 4) {
          txt = textOf(cur);
          if (txt) {
            if (/^(legal name|secretary of state identification number|status|citizenship|date formed|registered agent|mailing address|principal office address|registered office address|registered mailing address|company officials)$/i.test(txt)) {
              break;
            }

            if (isFooterJunkLine(txt)) {
              break;
            }

            lines.push(txt);
          }
          cur = cur.nextElementSibling;
        }

        if (lines.length) return cleanAddressValue(lines.join(', '));
      }
    }

    return '';
  }

  function extractOwnerFromOfficialsBlock() {
    const bodyText = textOf(document.body);
    const roleOrder = [
      'Managing Member',
      'Member',
      'Manager',
      'Owner',
      'President',
      'Officer'
    ];
    const stopLabels =
      '(?:legal name|secretary of state identification number|status|citizenship|date formed|registered agent|mailing address|principal office address|registered office address|registered mailing address)';

    const blockRe = new RegExp(
      'Company officials\\s*:?\\s*([\\s\\S]*?)(?:\\n\\s*' + stopLabels + '\\b|$)',
      'i'
    );
    const blockMatch = bodyText.match(blockRe);
    const blockText = blockMatch ? clean(blockMatch[1]) : '';

    if (!blockText) return { name: '', address: '' };

    const lines = blockText
      .split('\n')
      .map(clean)
      .filter(Boolean)
      .filter(function (line) {
        return !/^company officials$/i.test(line);
      });

    if (!lines.length) return { name: '', address: '' };

    function lineHasAnyRole(line) {
      return roleOrder.some(function (role) {
        return new RegExp('\\b' + escapeRegex(role) + '\\b', 'i').test(line);
      });
    }

    function looksLikeAddressLine(line) {
      return (
        /\d/.test(line) ||
        /\b(po box|p\.?o\.?\s*box|street|st\b|road|rd\b|avenue|ave\b|boulevard|blvd\b|suite|ste\b|unit|apt|lane|ln\b|drive|dr\b|court|ct\b|circle|cir\b|north carolina|nc\b)\b/i.test(line)
      );
    }

    function looksLikeBusinessName(line) {
      return /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|CO\.?)\b/i.test(line);
    }

    function findNameAndAddressForRole(role) {
      const roleRe = new RegExp('\\b' + escapeRegex(role) + '\\b', 'i');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!roleRe.test(line)) continue;

        let name = '';
        let nameLineIndex = i;

        let m = line.match(new RegExp('^' + escapeRegex(role) + '\\s*[:\\-]?\\s*(.+)$', 'i'));
        if (m && m[1]) {
          name = clean(m[1]);
        }

        if (!name) {
          m = line.match(new RegExp('^(.+?)\\s*[,\\-\\(]\\s*' + escapeRegex(role) + '\\)?\\s*$', 'i'));
          if (m && m[1]) {
            name = clean(m[1]);
          }
        }

        if (!name) {
          const stripped = clean(line.replace(roleRe, '').replace(/^[:,\-\s]+|[:,\-\s]+$/g, ''));
          if (stripped && !looksLikeAddressLine(stripped)) {
            name = stripped;
          }
        }

        if (!name) {
          for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
            const next = lines[j];
            if (lineHasAnyRole(next)) break;
            if (looksLikeAddressLine(next)) continue;
            name = next;
            nameLineIndex = j;
            break;
          }
        }

        if (!name || looksLikeBusinessName(name)) continue;

        const addressParts = [];
        const start = Math.max(i + 1, nameLineIndex + 1);
        for (let k = start; k < Math.min(lines.length, start + 4); k++) {
          const nextLine = lines[k];
          if (!nextLine) continue;
          if (lineHasAnyRole(nextLine)) break;
          if (nextLine === name) continue;
          addressParts.push(nextLine);
        }

        return {
          name: clean(name),
          address: clean(addressParts.join(', ')),
          role: role
        };
      }

      return null;
    }

    for (let i = 0; i < roleOrder.length; i++) {
      const hit = findNameAndAddressForRole(roleOrder[i]);
      if (hit && hit.name) {
        return { name: hit.name, address: hit.address };
      }
    }

    return { name: '', address: '' };
  }

  if (isNcicApp) {
    (async function () {
      log('Running on NCIC app');

      window.addEventListener('NCIC_SOS_TOGGLE', async function () {
        const on = await isEnabled();
        await setEnabled(!on);
        updateToggleButtonUI(await isEnabled());
        log('Toggled:', (await isEnabled()) ? 'ON' : 'OFF');
      });

      updateToggleButtonUI(await isEnabled());

      setInterval(function () {
        (async function () {
          try {
            const token = await GM_getValue(REFRESH_TOKEN_KEY, 0);
            if (token && token !== window.__ncicLastRefreshToken) {
              window.__ncicLastRefreshToken = token;
              await GM_setValue(REFRESH_TOKEN_KEY, 0);
              log('Detected SOS update token, reloading NCIC page...');
              location.reload();
            }
          } catch (e) {
            console.warn('[NCIC SOS] Error checking refresh token', e);
          }
        })();
      }, 3000);

      document.addEventListener('click', async function (e) {
        const btn = e.target.closest('.sos-btn');
        if (!btn) return;

        if (!(await isEnabled())) {
          log('Disabled (ignored SOS click).');
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        const name = clean(btn.dataset.employer || btn.textContent || '');
        const targetKey = clean(btn.dataset.targetKey || '');

        if (!name) {
          alert('No employer name found for SOS search.');
          return;
        }

        const base = location.origin.replace(/\/+$/, '');
        await GM_setValue(LAST_BASE_KEY, base);
        await GM_setValue(LAST_NAME_KEY, name);
        await GM_setValue(LAST_TARGET_KEY, targetKey);

        copyToClipboard(name);

        window.open(
          'https://www.sosnc.gov/online_services/search/by_title/search_Business_Registration',
          '_blank',
          'noopener'
        );

        log('Stored name + base + targetKey, opened SOS search:', {
          name: name,
          base: base,
          targetKey: targetKey
        });
      });
    })();

    return;
  }

  if (isSosSearch) {
    (async function () {
      if (!(await isEnabled())) {
        log('Disabled (SOS search auto-fill skipped).');
        return;
      }

      log('On SOS search page');

      window.addEventListener('load', async function () {
        if (!(await isEnabled())) {
          log('Disabled (load handler skipped).');
          return;
        }

        const storedName = clean(await GM_getValue(LAST_NAME_KEY, ''));
        if (!storedName) {
          log('No stored business name.');
          return;
        }

        const input = document.getElementById('SearchCriteria');
        const button = document.getElementById('SubmitButton');

        if (!input || !button) {
          log('Search input or button not found.');
          return;
        }

        input.focus();
        input.value = storedName;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        log('Prefilled search with:', storedName);
        button.click();
      });
    })();

    return;
  }

  if (isSosResults) {
    (async function () {
      if (!(await isEnabled())) {
        log('Disabled (SOS results helper skipped).');
        return;
      }

      log('On SOS results page');

      function findMoreInformationLink(container) {
        if (!container) return false;

        const links = Array.prototype.slice.call(container.querySelectorAll('a'));
        for (let i = 0; i < links.length; i++) {
          const txt = clean(links[i].textContent || '');
          if (/more information/i.test(txt)) {
            return links[i];
          }
        }
        return null;
      }

      function clickMoreInformationFromContainer(container, sourceEl) {
        const more = findMoreInformationLink(container);
        if (!more) return false;

        if (sourceEl && sourceEl === more) return false;

        log('Auto-clicking More Information...');
        more.click();
        return true;
      }

      function tryNearbyMoreInformation(clickedEl, opts) {
        if (!clickedEl) return false;
        const options = opts || {};
        const sourceEl = options.sourceEl || null;

        const selectors = [
          '.usa-accordion',
          '.usa-accordion__content',
          '.usa-accordion__heading',
          'li',
          'tr',
          '.views-row',
          '.result',
          '.search-result'
        ];

        for (let i = 0; i < selectors.length; i++) {
          const box = clickedEl.closest(selectors[i]);
          if (box && clickMoreInformationFromContainer(box, sourceEl)) {
            return true;
          }
        }

        let el = clickedEl.parentElement;
        let depth = 0;
        while (el && depth < 6) {
          if (clickMoreInformationFromContainer(el, sourceEl)) {
            return true;
          }
          el = el.parentElement;
          depth++;
        }

        return false;
      }

      document.addEventListener('click', function (e) {
        const target = e.target;
        if (!target) return;

        const txt = clean(target.textContent || '');

        if (/more information/i.test(txt)) {
          log('More Information clicked directly');
          return;
        }

        const accordionBtn = target.closest('button.usa-accordion__button');
        if (accordionBtn) {
          log('Accordion clicked, waiting for More Information...');
          setTimeout(function () {
            tryNearbyMoreInformation(accordionBtn);
          }, 250);
          return;
        }

        const clickedLink = target.closest('a');
        if (clickedLink) {
          const linkTxt = clean(clickedLink.textContent || '');
          if (linkTxt && !/more information/i.test(linkTxt)) {
            log('Result link clicked, trying to auto-open More Information...');
            const handled = tryNearbyMoreInformation(clickedLink, { sourceEl: clickedLink });
            if (handled) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            setTimeout(function () {
              tryNearbyMoreInformation(clickedLink, { sourceEl: clickedLink });
            }, 250);
          }
        }
      }, true);

      function bindHints() {
        const links = Array.prototype.slice.call(document.querySelectorAll('a'));
        for (let i = 0; i < links.length; i++) {
          const a = links[i];
          if (a.__ncicBound) continue;
          a.__ncicBound = true;

          const txt = clean(a.textContent || '');
          if (/more information/i.test(txt)) {
            a.addEventListener('click', function () {
              log('More Information clicked');
            });
          }
        }
      }

      bindHints();

      new MutationObserver(bindHints).observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    })();

    return;
  }

  if (isSosProfile) {
    (async function () {
      if (!(await isEnabled())) {
        log('Disabled (SOS profile scrape skipped).');
        return;
      }

      log('On SOS profile page');

      function cleanLegalName(v) {
        let s = clean(v || '');
        if (!s) return '';
        s = clean(s.split('\n')[0]);
        s = clean(s.replace(/\s{2,}.+$/, ''));
        return s;
      }

      const legalName = cleanLegalName(
        getValueAfterLabel('Legal name') ||
        clean(await GM_getValue(LAST_NAME_KEY, ''))
      );

      const registeredAgent = getValueAfterLabel('Registered agent');

      const registeredMailing =
        getBlockAfterHeader('Registered Mailing address') ||
        getBlockAfterHeader('Mailing address') ||
        getBlockAfterHeader('Registered Office address') ||
        getBlockAfterHeader('Principal Office address');

      const ownerFromOfficials = extractOwnerFromOfficialsBlock();

      const ownerName = ownerFromOfficials.name || registeredAgent || '';
      const ownerAddress = cleanAddressValue(ownerFromOfficials.address || registeredMailing || '');

      const businessName = clean(await GM_getValue(LAST_NAME_KEY, '')) || legalName;
      const base = clean(await GM_getValue(LAST_BASE_KEY, ''));
      const targetKey = clean(await GM_getValue(LAST_TARGET_KEY, ''));

      const debugExtracted = {
        legalName: legalName,
        registeredAgent: registeredAgent,
        registeredMailing: registeredMailing,
        ownerFromOfficials: ownerFromOfficials,
        targetKey: targetKey
      };

      log('Extracted:', debugExtracted);

      if (!base) {
        console.warn('[NCIC SOS] No base URL stored; cannot POST back.');
        return;
      }

      const payload = {
        employer_name: businessName,
        legalName: legalName,
        owner_name: ownerName,
        owner_address: ownerAddress,
        source_url: location.href,
        targetKey: targetKey
      };

      log('Posting payload:', payload);

      GM_xmlhttpRequest({
        method: 'POST',
        url: base + '/api/sos_officials',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(payload),
        onload: async function (resp) {
          log('POST complete:', resp.status, resp.responseText);
          await GM_setValue(REFRESH_TOKEN_KEY, Date.now());
        },
        onerror: function (err) {
          console.error('[NCIC SOS] POST failed:', err);
        }
      });
    })();

    return;
  }

    if (isSosFilings) {
    (async function () {
      if (!(await isEnabled())) {
        log('Disabled (SOS filings helper skipped).');
        return;
      }

      log('On SOS filings page');

      function getRequestVerificationToken() {
        const el = document.querySelector('input[name="__RequestVerificationToken"]');
        return el ? clean(el.value || '') : '';
      }

      async function openFilingPdfInTab(filingId) {
        const token = getRequestVerificationToken();
        if (!filingId || !token) {
          console.warn('[NCIC SOS] Missing filing id or antiforgery token.');
          return false;
        }

        const newTab = window.open('', '_blank');
        if (newTab) {
          try {
            newTab.document.write('<title>Loading PDF...</title><div style="font-family:Arial;padding:16px;">Loading SOS filing PDF...</div>');
          } catch (e) {}
        }

        try {
          const body = new URLSearchParams();
          body.set('id', filingId);
          body.set('__RequestVerificationToken', token);

          const resp = await fetch('/online_services/imaging/download_ivault_pdf_imaging', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body.toString()
          });

          if (!resp.ok) {
            throw new Error('HTTP ' + resp.status);
          }

          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);

          if (newTab) {
            newTab.location.href = blobUrl;
          } else {
            window.open(blobUrl, '_blank');
          }

          setTimeout(function () {
            URL.revokeObjectURL(blobUrl);
          }, 60000);

          log('Opened filing PDF in blob tab for id:', filingId);
          return true;
        } catch (err) {
          console.error('[NCIC SOS] Failed to open filing PDF in tab:', err);

          if (newTab && !newTab.closed) {
            try {
              newTab.close();
            } catch (e) {}
          }

          return false;
        }
      }

      document.addEventListener('click', function (e) {
        const link = e.target && e.target.closest('a');
        if (!link) return;

        const filingId = clean(link.id || '');
        const linkText = clean(link.textContent || '');

        const isPdfLink =
          /view filing\s*\(pdf\)/i.test(linkText) ||
          /ImageClick\s*\(/i.test(link.getAttribute('onclick') || '');

        if (!isPdfLink || !filingId) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        openFilingPdfInTab(filingId).then(function (ok) {
          if (!ok) {
            console.warn('[NCIC SOS] Falling back to original click for filing id:', filingId);
            try {
              if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.ImageClick === 'function') {
                unsafeWindow.ImageClick(filingId);
              } else if (typeof window.ImageClick === 'function') {
                window.ImageClick(filingId);
              }
            } catch (err) {
              console.error('[NCIC SOS] Fallback ImageClick failed:', err);
            }
          }
        });
      }, true);
    })();

    return;
  }

})();
