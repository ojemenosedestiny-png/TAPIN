/** Shared with components/theme/theme.tsx. A plain module, so the server layout gets the real string. */
export const THEME_KEY = "tapin.theme";

/**
 * Runs before the first paint so the page never flashes the wrong theme.
 * Kept tiny and dependency-free; mirrors applyTheme().
 */
export const THEME_SCRIPT = `(function(){try{if(location.pathname.indexOf('/kiosk')===0)return;var t=localStorage.getItem('${THEME_KEY}');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;if(d)e.classList.add('dark');e.style.colorScheme=d?'dark':'light'}catch(_){}})()`;
