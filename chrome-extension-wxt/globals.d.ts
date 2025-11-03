// Global type declarations for Chrome extension

// WXT provides 'browser' globally, and Chrome extensions use 'chrome'
// This declares 'chrome' as an alias to 'browser' for type checking
declare const chrome: typeof browser;
