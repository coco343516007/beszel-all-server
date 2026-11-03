(() => {
  "use strict";

  const BUTTON_ID = "beszel-my-services";
  const STYLE_ID = "beszel-my-services-style";
  const CONTAINERS_SELECTOR = 'a[href="/containers"]';

  // Inline the SVG stored beside this script so the icon does not require a
  // second public Nginx location. `currentColor` keeps it theme-aware.
  const LOGO_SVG = `
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg"
      width="24" height="24" viewBox="0 0 1024 1024" fill="currentColor"
      class="h-[1.2rem] w-[1.2rem]">
      <path d="M819.2 157.627733a68.266667 68.266667 0 0 0-98.781867-61.064533L512 200.772267 303.581867 96.5632A68.266667 68.266667 0 0 0 204.8 157.696v162.577067a68.266667 68.266667 0 0 0 98.781867 61.064533L512 277.0944l208.418133 104.209067A68.266667 68.266667 0 0 0 819.2 320.238933V157.627733z m-68.266667 162.6112L588.322133 238.933333 750.933333 157.627733v162.6112zM273.066667 157.627733L435.677867 238.933333 273.066667 320.238933V157.627733z m568.285866 176.810667C885.077333 294.365867 955.733333 325.4272 955.733333 384.8192V750.933333a102.4 102.4 0 0 1-102.4 102.4H170.666667a102.4 102.4 0 0 1-102.4-102.4V384.785067c0-59.392 70.621867-90.453333 114.3808-50.312534L136.533333 384.785067V750.933333a34.133333 34.133333 0 0 0 34.133334 34.133334h682.666666a34.133333 34.133333 0 0 0 34.133334-34.133334V384.785067l-306.2784 280.746666a102.4 102.4 0 0 1-138.376534 0L136.533333 384.785067 182.647467 334.506667l306.2784 280.746666a34.133333 34.133333 0 0 0 46.148266 0l306.2784-280.746666zM512 409.6a34.133333 34.133333 0 0 1 34.133333 34.133333v68.266667a34.133333 34.133333 0 1 1-68.266666 0v-68.266667a34.133333 34.133333 0 0 1 34.133333-34.133333z m136.533333 273.066667a34.133333 34.133333 0 0 1 34.133334-34.133334h102.4a34.133333 34.133333 0 1 1 0 68.266667h-102.4a34.133333 34.133333 0 0 1-34.133334-34.133333zM68.266667 921.6a34.133333 34.133333 0 0 1 34.133333-34.133333h819.2a34.133333 34.133333 0 1 1 0 68.266666H102.4a34.133333 34.133333 0 0 1-34.133333-34.133333z" />
    </svg>`;

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} {
        position: relative;
      }

      #${BUTTON_ID} .beszel-my-services-tooltip {
        position: absolute;
        top: calc(100% + 10px);
        left: 50%;
        z-index: 1000;
        width: max-content;
        padding: 6px 12px;
        transform: translateX(-50%) translateY(-2px) scale(.95);
        transform-origin: top center;
        border: 1px solid var(--border, #ddd);
        border-radius: 0.675rem;
        background: var(--popover, #fff);
        color: var(--popover-foreground, #111);
        font-size: 14px;
        font-weight: 400;
        line-height: 20px;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        visibility: hidden;
        transition: opacity 150ms ease, transform 150ms ease, visibility 150ms;
      }

      #${BUTTON_ID} .beszel-my-services-tooltip-arrow {
        position: absolute;
        top: 0;
        left: calc(50% - 5px);
        transform: rotate(180deg);
        transform-origin: center 0;
      }

      #${BUTTON_ID} .beszel-my-services-tooltip-arrow svg {
        display: block;
        width: 10px;
        height: 5px;
        transform: translateY(calc(-50% - 2px)) rotate(45deg);
        border: 1px solid var(--border, #ddd);
        border-radius: 2px;
        background: var(--popover, #fff);
        fill: var(--popover, #fff);
        clip-path: inset(25% 0 0 25%);
      }

      #${BUTTON_ID}:hover .beszel-my-services-tooltip,
      #${BUTTON_ID}:focus-visible .beszel-my-services-tooltip {
        transform: translateX(-50%) translateY(0) scale(1);
        opacity: 1;
        visibility: visible;
      }
    `;
    document.head.appendChild(style);
  }

  function addMyServicesButton() {
    const containersLink = document.querySelector(CONTAINERS_SELECTOR);
    if (!containersLink || document.getElementById(BUTTON_ID)) return;

    addStyles();

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = containersLink.className;
    button.setAttribute("aria-label", "我的服务");
    button.innerHTML = `${LOGO_SVG}<span class="beszel-my-services-tooltip" role="tooltip">我的服务<span class="beszel-my-services-tooltip-arrow" aria-hidden="true"><svg viewBox="0 0 30 10" preserveAspectRatio="none"><polygon points="0,0 30,0 15,10"></polygon></svg></span></span>`;

    containersLink.before(button);
  }

  let scheduled = false;
  const scheduleInsertion = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      addMyServicesButton();
    });
  };

  scheduleInsertion();
  new MutationObserver(scheduleInsertion).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
