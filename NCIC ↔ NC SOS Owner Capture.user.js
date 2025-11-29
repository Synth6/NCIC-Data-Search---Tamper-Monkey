// ==UserScript==
// @name         NCIC ↔ NC SOS Owner Capture
// @namespace    mci-tools
// @version      1.2
// @description  From NCIC app: click SOS → open SOS search, prefill business name, auto-search. On results: your click on a company auto-clicks "More information". On the profile page: scrape Company officials OR Registered agent + Registered mailing address and POST back to NCIC /api/sos_officials.
// @match        http://localhost:5000/*
// @match        http://127.0.0.1:5000/*
// @match        https://www.sosnc.gov/online_services/search/by_title/search_Business_Registration*
// @match        https://www.sosnc.gov/online_services/search/Business_Registration_Results*
// @match        https://www.sosnc.gov/online_services/search/Business_Registration_profile/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  'use strict';

  const href = location.href;
  const host = location.hostname;
  const port = location.port;

  const LAST_NAME_KEY = 'ncic_last_business_name';
  const LAST_BASE_KEY = 'ncic_last_base_url';
  const REFRESH_TOKEN_KEY = 'ncic_refresh_token';

  const isNcicApp =
    port === '5000' &&
    (host === 'localhost' || host === '127.0.0.1' || host === '192.168.1.203');

  const isSosSearch =
    host === 'www.sosnc.gov' &&
    href.startsWith(
      'https://www.sosnc.gov/online_services/search/by_title/search_Business_Registration'
    );

  const isSosResults =
    host === 'www.sosnc.gov' &&
    href.startsWith(
      'https://www.sosnc.gov/online_services/search/Business_Registration_Results'
    );

  const isSosProfile =
    host === 'www.sosnc.gov' &&
    href.startsWith(
      'https://www.sosnc.gov/online_services/search/Business_Registration_profile/'
    );

  // --------------------------
  // Helper: copy fallback
  // --------------------------
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
      console.warn('Copy failed', e);
    }
    document.body.removeChild(ta);
  }

  function copyToClipboard(text) {
    if (!text) return;
    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  // ---------------------------------------------
  // PART 1: NCIC APP SIDE – click SOS button
  // ---------------------------------------------
  if (isNcicApp) {
    console.log('[NCIC SOS] Running on NCIC app');

    // --- Auto-refresh when SOS tab finishes and sets a token ---
    setInterval(() => {
      (async () => {
        try {
          const token = await GM_getValue(REFRESH_TOKEN_KEY, 0);
          if (token && token !== window.__ncicLastRefreshToken) {
            // Remember so we don't loop in the same session
            window.__ncicLastRefreshToken = token;

            // Clear the token BEFORE reload so we don't bounce forever
            await GM_setValue(REFRESH_TOKEN_KEY, 0);

            console.log('[NCIC SOS] Detected SOS update token, reloading NCIC page...');
            location.reload();
          }
        } catch (e) {
          console.warn('[NCIC SOS] Error checking refresh token', e);
        }
      })();
    }, 3000); // check every 3 seconds

    document.addEventListener('click', async function (e) {
      const btn = e.target.closest('.sos-btn');
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      const name = (btn.dataset.employer || btn.textContent || '').trim();
      if (!name) {
        alert('No employer name found for SOS search.');
        return;
      }

      // Remember which base URL to post back to
      const base = location.origin.replace(/\/+$/, '');
      await GM_setValue(LAST_BASE_KEY, base);
      await GM_setValue(LAST_NAME_KEY, name);

      // Also copy to clipboard as a backup
      copyToClipboard(name);

      // Open SOS search page
      window.open(
        'https://www.sosnc.gov/online_services/search/by_title/search_Business_Registration',
        '_blank',
        'noopener'
      );

      console.log('[NCIC SOS] Stored name + base, opened SOS search:', name, base);
    });

    return; // done on NCIC side
  }

  // ---------------------------------------------
  // PART 2: SOS SEARCH PAGE – prefill + search
  // ---------------------------------------------
  if (isSosSearch) {
    console.log('[NCIC SOS] On SOS search page');

    window.addEventListener('load', async function () {
      const storedName = (await GM_getValue(LAST_NAME_KEY, '')).trim();
      if (!storedName) {
        console.log('[NCIC SOS] No stored business name.');
        return;
      }

      const input = document.getElementById('SearchCriteria');
      const button = document.getElementById('SubmitButton');
      if (!input || !button) {
        console.log('[NCIC SOS] Search input or button not found (DOM changed?).');
        return;
      }

      input.focus();
      input.value = storedName;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      console.log('[NCIC SOS] Prefilled search with:', storedName);
      button.click();
    });

    return;
  }

  // ---------------------------------------------------
  // PART 3: SOS RESULTS – you click company, we click
  //         its "More information" link for you.
  // ---------------------------------------------------
  if (isSosResults) {
    console.log('[NCIC SOS] On SOS results page');

    document.addEventListener('click', function (e) {
      const accordionBtn = e.target.closest('button.usa-accordion__button');
      if (!accordionBtn) return;

      const panelId = accordionBtn.getAttribute('aria-controls');
      if (!panelId) return;

      // Let the panel expand first
      setTimeout(() => {
        const panel = document.getElementById(panelId);
        if (!panel) return;

        // Look for "More information" link inside that panel
        const infoLink = Array.from(
          panel.querySelectorAll('a.searchResultsLink, a')
        ).find(a =>
          a.textContent.trim().toLowerCase().startsWith('more information')
        );

        if (infoLink) {
          console.log('[NCIC SOS] Auto-clicking "More information" link.');
          infoLink.click();
        } else {
          console.log('[NCIC SOS] No "More information" link found in panel.');
        }
      }, 150);
    });

    return;
  }

  // ---------------------------------------------------
  // PART 4: SOS PROFILE PAGE – scrape owners + address
  //         and POST back to NCIC /api/sos_officials
  // ---------------------------------------------------
  if (isSosProfile) {
    console.log('[NCIC SOS] On SOS Business_Registration_profile page');

    (async function () {
      // Small delay so DOM settles
      await new Promise(r => setTimeout(r, 300));

      const base = (await GM_getValue(LAST_BASE_KEY, 'http://localhost:5000'))
        .replace(/\/+$/, '');
      const NCIC_API = base + '/api/sos_officials';

      function cleanText(t) {
        return (t || '').replace(/\s+/g, ' ').trim();
      }

      // Helper: text after a bold label (case-insensitive "startsWith")
      function getTextAfterBold(labelPrefix) {
        const spans = Array.from(
          document.querySelectorAll('div.para-small span.boldSpan')
        );
        const span = spans.find(s =>
          cleanText(s.textContent).toLowerCase()
            .startsWith(labelPrefix.toLowerCase())
        );
        if (!span) return '';

        const wrapper = span.closest('div.para-small');
        if (!wrapper) return '';

        const clone = wrapper.cloneNode(true);
        const bold = clone.querySelector('span.boldSpan');
        if (bold) bold.remove();

        return cleanText(
          clone.textContent.replace(/^[:\-\s]+/, '')
        );
      }

      // Legal name + SOSID
      function parseLegalName() {
        return getTextAfterBold('Legal name:');
      }

      function parseSosId() {
        // On the site this is "Secretary of State Identification Number (SOSID):"
        return getTextAfterBold('Secretary of State Identification Number');
      }

      // Registered agent
      function getRegisteredAgent() {
        const spans = Array.from(
          document.querySelectorAll('div.para-small span.boldSpan')
        );
        const span = spans.find(s =>
          cleanText(s.textContent).toLowerCase()
            .startsWith('registered agent')
        );
        if (!span) return '';

        const wrapper = span.closest('div.para-small');
        if (!wrapper) return '';

        const link = wrapper.querySelector('a');
        if (link) return cleanText(link.textContent);

        const clone = wrapper.cloneNode(true);
        const bold = clone.querySelector('span.boldSpan');
        if (bold) bold.remove();
        return cleanText(clone.textContent);
      }

      // Address block like "Registered mailing address"
      function getAddressBlock(labelPrefix) {
        const spans = Array.from(
          document.querySelectorAll('div.para-small span.boldSpan')
        );
        const span = spans.find(s =>
          cleanText(s.textContent).toLowerCase()
            .startsWith(labelPrefix.toLowerCase())
        );
        if (!span) return null;

        const outer = span.closest('div.para-small');
        if (!outer) return null;

        const inner = outer.querySelector('div.para-small');
        if (!inner) return null;

        const rawHtml = inner.innerHTML || '';
        const parts = rawHtml.split('<br');

        const line1 = cleanText(
          parts[0]
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
        );

        const line2 = cleanText(
          (parts[1] || '')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
        );

        let city = '';
        let state = '';
        let zip = '';

        // Expect: "Raleigh, NC 27603-8950"
        const m = line2.match(/^([^,]+),\s*([A-Z]{2})\s+(.+)$/);
        if (m) {
          city = m[1].trim();
          state = m[2].trim();
          zip = m[3].trim();
        }

        return {
          address1: line1,
          city,
          state,
          zip
        };
      }

      // Company officials section
      function parseCompanyOfficials() {
        const officials = [];

        const officerHeading = Array.from(
          document.querySelectorAll('div.para-small span.boldSpan')
        ).find(s =>
          cleanText(s.textContent).toLowerCase().startsWith('company officials')
        );

        if (!officerHeading) return officials;

        const section = officerHeading.closest('section') || document;
        const listItems = section.querySelectorAll('ul li');

        listItems.forEach(li => {
          const roleSpan = li.querySelector('span.boldSpan');
          const nameLink = li.querySelector('div.para-small a');
          const addrDivs = li.querySelectorAll('div.para-small');

          const role = roleSpan ? cleanText(roleSpan.textContent) : '';
          const name = nameLink ? cleanText(nameLink.textContent) : '';

          let addr1 = '';
          let city = '';
          let state = '';
          let zip = '';

          if (addrDivs.length > 1) {
            const addrHtml = addrDivs[1].innerHTML || '';
            const parts = addrHtml.split('<br');
            const line1 = cleanText(
              parts[0]
                .replace(/<[^>]*>/g, '')
                .replace(/&nbsp;/g, ' ')
            );
            const line2 = cleanText(
              (parts[1] || '')
                .replace(/<[^>]*>/g, '')
                .replace(/&nbsp;/g, ' ')
            );

            const m2 = line2.match(/^([^ ]+.*?)\s+([A-Z]{2})\s+(.+)$/);
            if (m2) {
              city = m2[1].replace(/,$/, '').trim();
              state = m2[2].trim();
              zip = m2[3].trim();
            }
            addr1 = line1;
          }

          if (name || addr1) {
            officials.push({
              role,
              name,
              address1: addr1,
              city,
              state,
              zip
            });
          }
        });

        return officials;
      }

      const legalName = parseLegalName();
      const sosId = parseSosId();

      // 1) Try full Company officials list first
      let officials = parseCompanyOfficials();

      // 2) Fallback: Registered agent + Registered mailing address
      if (!officials.length) {
        const agentName = getRegisteredAgent();
        const mailAddr = getAddressBlock('Registered mailing');

        if (agentName || mailAddr) {
          officials.push({
            role: 'Registered Agent',
            name: agentName,
            address1: mailAddr ? mailAddr.address1 : '',
            city:    mailAddr ? mailAddr.city     : '',
            state:   mailAddr ? mailAddr.state    : '',
            zip:     mailAddr ? mailAddr.zip      : ''
          });
        }
      }

      if (!legalName && !sosId && !officials.length) {
        console.log('[NCIC SOS] No legal name / SOSID / officials found, not sending.');
        return;
      }
      if (!officials.length) {
        console.log('[NCIC SOS] No officials found (even with fallback), not sending.');
        return;
      }

      const payload = { legalName, sosId, officials };
      console.log('[NCIC SOS] Sending to NCIC API:', NCIC_API, payload);

      GM_xmlhttpRequest({
        method: 'POST',
        url: NCIC_API,
        data: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        onload: (res) => {
          console.log('[NCIC SOS] Response:', res.status, res.responseText);
          try {
            const data = JSON.parse(res.responseText);
            console.log(
              `[NCIC SOS] Stored ${data.count || 0} official(s) for`,
              legalName || sosId
            );
          } catch (e) {
            console.warn('[NCIC SOS] Sent officials but could not parse response.', e);
          }

          // Signal NCIC tab to refresh, then try to close this tab
          (async () => {
            try {
              await GM_setValue(REFRESH_TOKEN_KEY, Date.now());
            } catch (e) {
              console.warn('[NCIC SOS] Could not set refresh token', e);
            }

            try {
              window.close();
            } catch (e) {
              console.warn('Could not close SOS tab automatically.', e);
            }
          })();
        },
        onerror: (err) => {
          console.error('[NCIC SOS] Error sending to NCIC:', err);
          alert('Error sending officials to NCIC app. Check console.');
        }
      });

    })();  // <--- closes the async IIFE

    return;
  }

})()
