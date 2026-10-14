/**
 * App-shell and dialog chrome, translated between English and Tamil. Scope is deliberately
 * narrow (see Gap 14 in the fix-the-gaps plan): the nav rail, screen titles, sign-out, the
 * offline/default-password banners, and the Activation and ManagerApproval dialogs. Screen
 * bodies (Dashboard, Inventory, Purchases, Suppliers, Customers, Returns, Sales, Reports,
 * Employees, Settings, Alerts), error messages that come from the main process, audit-log
 * descriptions, and number/date formats are deliberately left in English — translating those
 * without a shop's day-to-day terms in front of us would be guessing.
 *
 * PRE-RELEASE: this Tamil wording is a first draft and has not been checked by a native
 * speaker. Treat every `ta` value here as needing review before a real shop relies on it —
 * the same caution as the activation keypair in activationPublicKey.ts.
 */

export type UiLanguage = "en" | "ta";

export const UI_LANGUAGE_KEY = "ui.language";

export function parseUiLanguage(value: string | null | undefined): UiLanguage {
  return value === "ta" ? "ta" : "en";
}

export interface UiStringEntry {
  en: string;
  ta: string;
}

export const UI_STRINGS = {
  "nav.dashboard": { en: "Dashboard", ta: "முகப்பு" },
  "nav.billing": { en: "Billing", ta: "பில்லிங்" },
  "nav.inventory": { en: "Inventory", ta: "சரக்கு" },
  "nav.sales": { en: "Sales", ta: "விற்பனை" },
  "nav.customers": { en: "Customers", ta: "வாடிக்கையாளர்கள்" },
  "nav.purchases": { en: "Purchases", ta: "கொள்முதல்" },
  "nav.suppliers": { en: "Suppliers", ta: "விநியோகஸ்தர்கள்" },
  "nav.returns": { en: "Returns", ta: "திரும்பப்பெறுதல்" },
  "nav.reports": { en: "Reports", ta: "அறிக்கைகள்" },
  "nav.employees": { en: "Employees", ta: "பணியாளர்கள்" },
  "nav.ai": { en: "AI Assistant", ta: "AI உதவியாளர்" },
  "nav.notifications": { en: "Notifications", ta: "அறிவிப்புகள்" },
  "nav.mobile": { en: "Owner Mobile", ta: "உரிமையாளர் மொபைல்" },
  "nav.settings": { en: "Settings", ta: "அமைப்புகள்" },
  "nav.help": { en: "Help", ta: "உதவி" },

  "title.dashboard": { en: "Dashboard", ta: "முகப்பு" },
  "title.billing": { en: "Billing", ta: "பில்லிங்" },
  "title.inventory": { en: "Inventory", ta: "சரக்கு" },
  "title.sales": { en: "Sales", ta: "விற்பனை" },
  "title.customers": { en: "Customers", ta: "வாடிக்கையாளர்கள்" },
  "title.purchases": { en: "Purchases", ta: "கொள்முதல்" },
  "title.suppliers": { en: "Suppliers", ta: "விநியோகஸ்தர்கள்" },
  "title.returns": { en: "Returns & refunds", ta: "திரும்பப்பெறுதல் மற்றும் பணம் திருப்பி அளித்தல்" },
  "title.reports": { en: "Reports", ta: "அறிக்கைகள்" },
  "title.employees": { en: "Employees", ta: "பணியாளர்கள்" },
  "title.ai": { en: "AI Assistant", ta: "AI உதவியாளர்" },
  "title.notifications": { en: "Notifications", ta: "அறிவிப்புகள்" },
  "title.mobile": { en: "Owner Mobile", ta: "உரிமையாளர் மொபைல்" },
  "title.settings": { en: "Settings", ta: "அமைப்புகள்" },
  "title.help": { en: "Help", ta: "உதவி" },

  "shell.signOut": { en: "Sign out", ta: "வெளியேறு" },
  "shell.offlineBanner": {
    en: "Offline mode — billing continues normally. Anything queued will sync when the connection returns.",
    ta: "ஆஃப்லைன் பயன்முறை — பில்லிங் வழக்கம் போல் தொடரும். இணைப்பு திரும்பியதும் காத்திருக்கும் தரவு ஒத்திசைக்கப்படும்.",
  },
  "shell.defaultPasswordBanner": {
    en: "You are signed in with the default password. Anyone who knows it can sign in as the owner.",
    ta: "நீங்கள் இயல்புநிலை கடவுச்சொல்லுடன் உள்நுழைந்துள்ளீர்கள். இதை அறிந்தவர் யாரும் உரிமையாளராக உள்நுழையலாம்.",
  },
  "shell.changePassword": { en: "Change password", ta: "கடவுச்சொல்லை மாற்று" },

  "approval.managerUsername": { en: "Manager username", ta: "மேலாளர் பயனர்பெயர்" },
  "approval.password": { en: "Password", ta: "கடவுச்சொல்" },
  "approval.cancel": { en: "Cancel", ta: "ரத்துசெய்" },
  "approval.approve": { en: "Approve", ta: "அங்கீகரி" },
  "approval.checking": { en: "Checking...", ta: "சரிபார்க்கிறது..." },

  "activation.heading": { en: "Activate this device", ta: "இந்த சாதனத்தை செயல்படுத்து" },
  "activation.intro": {
    en: "This copy of Supermarket POS needs to be activated before it can be used.",
    ta: "இந்த Supermarket POS பயன்பாட்டைப் பயன்படுத்தும் முன் செயல்படுத்த வேண்டும்.",
  },
  "activation.requestCode": { en: "Request code", ta: "கோரிக்கை குறியீடு" },
  "activation.copy": { en: "Copy", ta: "நகலெடு" },
  "activation.copied": { en: "Copied", ta: "நகலெடுக்கப்பட்டது" },
  "activation.giveCode": {
    en: "Give this code to whoever issued your copy of Supermarket POS — they will send back an activation key for this device.",
    ta: "இந்த குறியீட்டை உங்கள் Supermarket POS பிரதியை வழங்கியவரிடம் கொடுங்கள் — அவர்கள் இந்த சாதனத்திற்கான செயல்படுத்தல் விசையை அனுப்புவார்கள்.",
  },
  "activation.keyLabel": { en: "Activation key", ta: "செயல்படுத்தல் விசை" },
  "activation.keyPlaceholder": { en: "Paste the key you were given", ta: "உங்களுக்கு வழங்கப்பட்ட விசையை ஒட்டவும்" },
  "activation.activate": { en: "Activate", ta: "செயல்படுத்து" },
  "activation.activating": { en: "Activating…", ta: "செயல்படுத்துகிறது…" },
  "activation.genericError": {
    en: "That activation key could not be used.",
    ta: "அந்த செயல்படுத்தல் விசையைப் பயன்படுத்த முடியவில்லை.",
  },
  "activation.unreachable": {
    en: "Could not reach the local service. Please retry.",
    ta: "உள்ளூர் சேவையைத் தொடர்பு கொள்ள முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
  },
} satisfies Record<string, UiStringEntry>;

export type UiStringKey = keyof typeof UI_STRINGS;

/**
 * Substitutes `{name}` placeholders in the resolved string. `dictionary` defaults to
 * `UI_STRINGS` but can be overridden — used by this module's own tests to check placeholder
 * substitution without adding a synthetic entry to the real, user-facing string table.
 */
export function translate(
  key: string,
  lang: UiLanguage,
  params?: Record<string, string | number>,
  dictionary: Record<string, UiStringEntry> = UI_STRINGS,
): string {
  const entry = dictionary[key];
  let text = entry ? entry[lang] : key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
