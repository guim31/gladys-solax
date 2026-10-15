// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted". Vocabulary of the Gladys
// front (front/src/config/i18n) where it has the word. Brands stay as is.
// test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

/** Feature names, frozen by Gladys when the device is created. */
export const NAMES = {
  en: {
    pv_power: 'PV power',
    pv_string_power: (n) => `PV string ${n} power`,
    yield_today: 'Production today',
    yield_total: 'Total production',
    ac_power: 'AC output power',
    grid_power: 'Grid (import +, export −)',
    grid_import_total: 'Grid import index',
    grid_export_total: 'Grid export index',
    battery_soc: 'Battery level',
    battery_charge_power: 'Battery charge power',
    battery_discharge_power: 'Battery discharge power',
    battery_temperature: 'Battery temperature',
    battery_charge_total: 'Battery charge index',
    battery_discharge_total: 'Battery discharge index',
    inverter_temperature: 'Inverter temperature',
    status: 'Inverter state',
    online: 'Online',
  },
  fr: {
    pv_power: 'Puissance PV',
    pv_string_power: (n) => `Puissance PV chaîne ${n}`,
    yield_today: 'Production du jour',
    yield_total: 'Production totale',
    ac_power: 'Puissance de sortie AC',
    grid_power: 'Réseau (import +, export −)',
    grid_import_total: 'Index import réseau',
    grid_export_total: 'Index export réseau',
    battery_soc: 'Niveau de batterie',
    battery_charge_power: 'Puissance de charge batterie',
    battery_discharge_power: 'Puissance de décharge batterie',
    battery_temperature: 'Température batterie',
    battery_charge_total: 'Index de charge batterie',
    battery_discharge_total: 'Index de décharge batterie',
    inverter_temperature: 'Température onduleur',
    status: "État de l'onduleur",
    online: 'En ligne',
  },
  de: {
    pv_power: 'PV-Leistung',
    pv_string_power: (n) => `PV-Leistung String ${n}`,
    yield_today: 'Produktion heute',
    yield_total: 'Gesamtproduktion',
    ac_power: 'AC-Ausgangsleistung',
    grid_power: 'Netz (Bezug +, Einspeisung −)',
    grid_import_total: 'Netzbezugszähler',
    grid_export_total: 'Netzeinspeisezähler',
    battery_soc: 'Batteriestand',
    battery_charge_power: 'Batterie-Ladeleistung',
    battery_discharge_power: 'Batterie-Entladeleistung',
    battery_temperature: 'Batterietemperatur',
    battery_charge_total: 'Batterie-Lade-Index',
    battery_discharge_total: 'Batterie-Entlade-Index',
    inverter_temperature: 'Wechselrichtertemperatur',
    status: 'Wechselrichterzustand',
    online: 'Online',
  },
  es: {
    pv_power: 'Potencia FV',
    pv_string_power: (n) => `Potencia FV string ${n}`,
    yield_today: 'Producción de hoy',
    yield_total: 'Producción total',
    ac_power: 'Potencia de salida CA',
    grid_power: 'Red (importación +, exportación −)',
    grid_import_total: 'Índice de importación de la red',
    grid_export_total: 'Índice de exportación de la red',
    battery_soc: 'Nivel de batería',
    battery_charge_power: 'Potencia de carga de la batería',
    battery_discharge_power: 'Potencia de descarga de la batería',
    battery_temperature: 'Temperatura de la batería',
    battery_charge_total: 'Índice de carga de la batería',
    battery_discharge_total: 'Índice de descarga de la batería',
    inverter_temperature: 'Temperatura del inversor',
    status: 'Estado del inversor',
    online: 'En línea',
  },
};

/** The inverter states (models.js STATUS_KEYS, plus `unknown`). */
export const STATUS_LABELS = {
  en: {
    waiting: 'Waiting',
    checking: 'Checking',
    normal: 'Normal',
    fault: 'Fault',
    permanent_fault: 'Permanent fault',
    updating: 'Updating',
    eps_check: 'Backup check',
    eps: 'Backup (EPS)',
    self_test: 'Self-test',
    idle: 'Idle',
    standby: 'Standby',
    pv_wake_up_battery: 'PV waking battery',
    generator_check: 'Generator check',
    generator_run: 'Generator running',
    unknown: 'Unknown',
    offline: 'Offline',
  },
  fr: {
    waiting: 'En attente',
    checking: 'Vérification',
    normal: 'Normal',
    fault: 'Défaut',
    permanent_fault: 'Défaut permanent',
    updating: 'Mise à jour',
    eps_check: 'Contrôle secours',
    eps: 'Secours (EPS)',
    self_test: 'Autotest',
    idle: 'Inactif',
    standby: 'Veille',
    pv_wake_up_battery: 'Réveil batterie par PV',
    generator_check: 'Contrôle générateur',
    generator_run: 'Générateur en marche',
    unknown: 'Inconnu',
    offline: 'Hors ligne',
  },
  de: {
    waiting: 'Wartet',
    checking: 'Prüfung',
    normal: 'Normal',
    fault: 'Fehler',
    permanent_fault: 'Dauerhafter Fehler',
    updating: 'Aktualisierung',
    eps_check: 'Notstromprüfung',
    eps: 'Notstrom (EPS)',
    self_test: 'Selbsttest',
    idle: 'Leerlauf',
    standby: 'Standby',
    pv_wake_up_battery: 'PV weckt Batterie',
    generator_check: 'Generatorprüfung',
    generator_run: 'Generator läuft',
    unknown: 'Unbekannt',
    offline: 'Offline',
  },
  es: {
    waiting: 'En espera',
    checking: 'Comprobación',
    normal: 'Normal',
    fault: 'Fallo',
    permanent_fault: 'Fallo permanente',
    updating: 'Actualizando',
    eps_check: 'Comprobación de respaldo',
    eps: 'Respaldo (EPS)',
    self_test: 'Autodiagnóstico',
    idle: 'Inactivo',
    standby: 'En reposo',
    pv_wake_up_battery: 'FV activando batería',
    generator_check: 'Comprobación del generador',
    generator_run: 'Generador en marcha',
    unknown: 'Desconocido',
    offline: 'Sin conexión',
  },
};

/** Messages: connection status, action results, widget, scene action. */
export const TEXT = {
  notConfigured: {
    en: 'Enter the IP address of a SolaX dongle, or a SolaX Cloud token and serial number.',
    fr: "Saisissez l'adresse IP d'une clé SolaX, ou un jeton et un numéro de série SolaX Cloud.",
    de: 'Gib die IP-Adresse eines SolaX-Dongles ein, oder ein SolaX-Cloud-Token und eine Seriennummer.',
    es: 'Introduzca la dirección IP de un dongle SolaX, o un token y un número de serie de SolaX Cloud.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  noneAnswers: {
    en: 'No SolaX inverter answers. Use "Test the connection" for the details.',
    fr: 'Aucun onduleur SolaX ne répond. Utilisez « Tester la connexion » pour le détail.',
    de: 'Kein SolaX-Wechselrichter antwortet. Nutze „Verbindung testen“ für die Details.',
    es: 'Ningún inversor SolaX responde. Use «Probar la conexión» para ver los detalles.',
  },
  someAnswer: {
    en: 'Some SolaX inverters do not answer. Use "Test the connection" for the details.',
    fr: 'Certains onduleurs SolaX ne répondent pas. Utilisez « Tester la connexion » pour le détail.',
    de: 'Einige SolaX-Wechselrichter antworten nicht. Nutze „Verbindung testen“ für die Details.',
    es: 'Algunos inversores SolaX no responden. Use «Probar la conexión» para ver los detalles.',
  },
  // Pieces of the "Test the connection" report.
  ok: {
    en: 'answers',
    fr: 'répond',
    de: 'antwortet',
    es: 'responde',
  },
  unreachable: {
    en: 'no answer (address, network, or dongle asleep at night)',
    fr: 'aucune réponse (adresse, réseau, ou clé endormie la nuit)',
    de: 'keine Antwort (Adresse, Netzwerk, oder Dongle nachts im Ruhezustand)',
    es: 'sin respuesta (dirección, red, o dongle en reposo por la noche)',
  },
  refused: {
    en: 'refused: check the password (registration number of the dongle)',
    fr: 'refus : vérifiez le mot de passe (numéro d’enregistrement de la clé)',
    de: 'abgelehnt: Prüfe das Passwort (Registriernummer des Dongles)',
    es: 'rechazado: compruebe la contraseña (número de registro del dongle)',
  },
  unsupported: {
    en: 'model not recognized, please report it with the "probe" output',
    fr: 'modèle non reconnu, signalez-le avec la sortie du script « probe »',
    de: 'Modell nicht erkannt, melde es bitte mit der Ausgabe von „probe“',
    es: 'modelo no reconocido, por favor notifíquelo con la salida de «probe»',
  },
  notInverter: {
    en: 'this device is not an inverter (charging station)',
    fr: "cet appareil n'est pas un onduleur (borne de recharge)",
    de: 'dieses Gerät ist kein Wechselrichter (Ladestation)',
    es: 'este dispositivo no es un inversor (punto de recarga)',
  },
  cloudRefused: {
    en: 'refused by SolaX Cloud: check the token and the registration number',
    fr: 'refus de SolaX Cloud : vérifiez le jeton et le numéro d’enregistrement',
    de: 'von SolaX Cloud abgelehnt: Prüfe das Token und die Registriernummer',
    es: 'rechazado por SolaX Cloud: compruebe el token y el número de registro',
  },
  invalidHosts: {
    en: 'Ignored addresses:',
    fr: 'Adresses ignorées :',
    de: 'Ignorierte Adressen:',
    es: 'Direcciones ignoradas:',
  },
  nothingToTest: {
    en: 'Nothing to test: enter an IP address or a SolaX Cloud serial number first.',
    fr: "Rien à tester : saisissez d'abord une adresse IP ou un numéro de série SolaX Cloud.",
    de: 'Nichts zu testen: Gib zuerst eine IP-Adresse oder eine SolaX-Cloud-Seriennummer ein.',
    es: 'Nada que probar: introduzca primero una dirección IP o un número de serie de SolaX Cloud.',
  },
  // Widget.
  pickInverter: {
    en: 'Choose a SolaX inverter in the settings of this widget.',
    fr: 'Choisissez un onduleur SolaX dans les réglages de ce widget.',
    de: 'Wähle in den Einstellungen dieses Widgets einen SolaX-Wechselrichter aus.',
    es: 'Elija un inversor SolaX en la configuración de este widget.',
  },
  noData: {
    en: 'No reading from this inverter yet: it may be asleep (night) or unreachable.',
    fr: 'Pas encore de mesure de cet onduleur : il dort peut-être (nuit) ou il est injoignable.',
    de: 'Noch keine Messung von diesem Wechselrichter: Er schläft vielleicht (Nacht) oder ist nicht erreichbar.',
    es: 'Todavía no hay medidas de este inversor: puede estar en reposo (noche) o inaccesible.',
  },
  pv: { en: 'Solar', fr: 'Solaire', de: 'Solar', es: 'Solar' },
  today: { en: 'Today', fr: "Aujourd'hui", de: 'Heute', es: 'Hoy' },
  grid: { en: 'Grid', fr: 'Réseau', de: 'Netz', es: 'Red' },
  battery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  charging: { en: 'Charging', fr: 'Charge', de: 'Laden', es: 'Carga' },
  discharging: { en: 'Discharging', fr: 'Décharge', de: 'Entladen', es: 'Descarga' },
  resting: { en: 'At rest', fr: 'Au repos', de: 'Ruhe', es: 'En reposo' },
  importing: { en: 'Importing', fr: 'Soutirage', de: 'Bezug', es: 'Importación' },
  exporting: { en: 'Exporting', fr: 'Injection', de: 'Einspeisung', es: 'Exportación' },
  balanced: { en: 'Balanced', fr: 'Équilibre', de: 'Ausgeglichen', es: 'Equilibrio' },
  inverter: { en: 'Inverter', fr: 'Onduleur', de: 'Wechselrichter', es: 'Inversor' },
  updated: { en: 'Updated', fr: 'Mis à jour', de: 'Aktualisiert', es: 'Actualizado' },
  viaCloud: {
    en: 'via SolaX Cloud',
    fr: 'via SolaX Cloud',
    de: 'über SolaX Cloud',
    es: 'vía SolaX Cloud',
  },
  local: { en: 'local', fr: 'local', de: 'lokal', es: 'local' },
  chart: {
    en: 'Production and grid',
    fr: 'Production et réseau',
    de: 'Produktion und Netz',
    es: 'Producción y red',
  },
  // Scene action.
  summary: {
    en: (s) =>
      `Solar: ${s.pv} now, ${s.today} today.` +
      (s.grid ? ` Grid: ${s.grid}.` : '') +
      (s.battery ? ` Battery: ${s.battery}.` : ''),
    fr: (s) =>
      `Solaire : ${s.pv} en ce moment, ${s.today} aujourd'hui.` +
      (s.grid ? ` Réseau : ${s.grid}.` : '') +
      (s.battery ? ` Batterie : ${s.battery}.` : ''),
    de: (s) =>
      `Solar: gerade ${s.pv}, heute ${s.today}.` +
      (s.grid ? ` Netz: ${s.grid}.` : '') +
      (s.battery ? ` Batterie: ${s.battery}.` : ''),
    es: (s) =>
      `Solar: ${s.pv} ahora, ${s.today} hoy.` +
      (s.grid ? ` Red: ${s.grid}.` : '') +
      (s.battery ? ` Batería: ${s.battery}.` : ''),
  },
  noReading: {
    en: 'No reading from this SolaX inverter yet.',
    fr: 'Pas encore de mesure de cet onduleur SolaX.',
    de: 'Noch keine Messung von diesem SolaX-Wechselrichter.',
    es: 'Todavía no hay medidas de este inversor SolaX.',
  },
};

/** The text of a table in a language, English when missing. */
export const t = (text, language) => text?.[language] ?? text?.en;

/** A multi-language object built per language. */
export const perLanguage = (build) =>
  Object.fromEntries(['en', 'fr', 'de', 'es'].map((language) => [language, build(language)]));

/** A power in the user's language: "850 W", "1,2 kW". */
export function formatPower(watts, language) {
  const abs = Math.abs(watts);
  if (abs < 1000) {
    return `${Math.round(abs)} W`;
  }
  return `${(abs / 1000).toLocaleString(language, { maximumFractionDigits: 1 })} kW`;
}

/** An energy in the user's language: "12,3 kWh". */
export const formatEnergy = (kwh, language) =>
  `${kwh.toLocaleString(language, { maximumFractionDigits: 1 })} kWh`;
