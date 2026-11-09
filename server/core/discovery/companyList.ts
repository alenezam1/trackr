// Built-in CANDIDATE list of UK fintech, security, startup and scale-up employers (brand names). These are only
// starting points: each one is checked against the Skilled Worker register and probed for a public careers/ATS
// board at runtime. The AI company finder (Sponsor Registry page) can add hundreds more.
export const UK_FINTECH_STARTUPS: string[] = [
  // Fintech, banking & payments
  'Monzo', 'Revolut', 'Starling Bank', 'Wise', 'Checkout.com', 'GoCardless', 'OakNorth', 'Zopa', 'ClearScore', 'Curve', 'Tide', 'Atom Bank',
  'Allica Bank', 'Kroo', 'Chip', 'Moneybox', 'Plum', 'Freetrade', 'Trading 212', 'Nutmeg', 'Wealthify', 'PensionBee', 'Lendable', 'Funding Circle',
  'iwoca', 'Capital on Tap', 'Thought Machine', '10x Banking', 'Mambu', 'Railsr', 'Modulr', 'ClearBank', 'TrueLayer', 'Yapily', 'Token.io', 'Banked',
  'Paddle', 'Primer', 'Ebury', 'Airwallex', 'Payoneer', 'Rapyd', 'Paysafe', 'Worldpay', 'SumUp', 'Dojo', 'Paymentsense', 'Teya', 'Vitesse',
  'Cleo', 'Zilch', 'Lunar', 'Marshmallow', 'Cuvva', 'Zego', 'By Miles', 'Laka', 'Hiscox', 'Lemonade', 'Ondo', 'Bought By Many', 'ManyPets',
  'Onfido', 'Entrust', 'ComplyAdvantage', 'Quantexa', 'Featurespace', 'Ripjar', 'Napier AI', 'Sardine', 'Fourthline', 'Signicat', 'Yoti', 'Veriff',
  'Elliptic', 'Chainalysis', 'CoinShares', 'Copper', 'Zodia Custody', 'Archax', 'Bitstamp', 'Kraken', 'Gemini', 'Coinbase', 'Blockchain.com', 'Ziglu',
  'Starling', 'Monument Bank', 'Recognise Bank', 'Zempler Bank', 'Tandem Bank', 'Chetwood Financial', 'Molo', 'Habito', 'Mojo Mortgages', 'Generation Home',
  'Flagstone', 'Raisin', 'Hargreaves Lansdown', 'AJ Bell', 'interactive investor', 'Lightyear', 'Shares', 'Wealthsimple', 'Scalable Capital', 'Moneyfarm',
  'Codat', 'Pennylane', 'Pleo', 'Spendesk', 'Soldo', 'Payhawk', 'Juni', 'Tally', 'Previse', 'Satago', 'Fluidly', 'Kriya', 'Uncapped', 'Clearco',
  'Vanquis', 'Admiral', 'Aviva', 'Direct Line', 'LV=', 'Hastings', 'Ki Insurance', 'Concirrus', 'Artificial Labs', 'Cytora', 'Flock', 'Superscript',
  'Bud', 'Snoop', 'Emma', 'Lumio', 'Experian', 'Equifax', 'TransUnion', 'Credit Kudos', 'Aire', 'Fintern', 'Plend', 'Oodle', 'Carmoola', 'Koto',
  'LMAX Exchange', 'Smart Pension', 'Hymans Robertson', 'Seccl', 'FNZ', 'Bravura', 'Calastone', 'Clearscore', 'Tink', 'Plaid', 'Stripe', 'Adyen',
  // Cyber security & identity
  'Darktrace', 'Snyk', 'Tessian', 'CybSafe', 'Immersive Labs', 'Hack The Box', 'Cyberhaven', 'Egress', 'Socura', 'Bridewell', 'NCC Group', 'Sophos',
  'Mimecast', 'Ripjar', 'Censornet', 'Arctic Wolf', 'CrowdStrike', 'SentinelOne', 'Rapid7', 'Tenable', 'Okta', 'Cloudflare', 'Elastic', 'Datadog',
  'Huntsman Security', 'ZeroFox', 'Intruder', 'Detectify', 'Orca Security', 'Wiz', 'Vanta', 'Drata', 'OneTrust', 'Secureworks', 'BlueVoyant',
  'Quorum Cyber', 'Integrity360', 'CyberCX', 'Socitm', 'Prism Infosec', 'Pentest People', 'Nettitude', 'LRQA', 'Claranet', 'Six Degrees', 'Redscan',
  'Cyber Security Associates', 'ReliaQuest', 'Expel', 'Huntress', 'Abnormal Security', 'Proofpoint', 'KnowBe4', 'CultureAI', 'Hoxhunt', 'Cybersmart',
  'Bitdefender', 'ESET', 'Kaspersky', 'Trend Micro', 'Check Point', 'Palo Alto Networks', 'Zscaler', 'Netskope', 'Illumio', 'Varonis', 'Thales',
  // Startups & scale-ups (tech)
  'Deliveroo', 'Ocado Technology', 'Skyscanner', 'Bloom & Wild', 'Gousto', 'Cazoo', 'Octopus Energy', 'Kraken Technologies', 'Bulb', 'OVO',
  'Babylon', 'Cera', 'Huma', 'Thriva', 'Zava', 'Lindus Health', 'Peak', 'Faculty', 'Wayve', 'Synthesia', 'ElevenLabs', 'PolyAI', 'Stability AI',
  'Tractable', 'Cleo AI', 'Signal AI', 'Builder.ai', 'Graphcore', 'Arm', 'Improbable', 'Multiverse', 'Hopin', 'Paddle', 'Pento', 'Personio',
  'Deel', 'Remote', 'Oyster', 'Beamery', 'Workable', 'Hibob', 'Cord', 'Otta', 'Welcome to the Jungle', 'Bright Network', 'Sona', 'Juro',
  'Luminance', 'Robin AI', 'Harbour', 'Patchwork Health', 'Accurx', 'Birdie', 'Lantum', 'Healx', 'Benevolent AI', 'Exscientia', 'Isomorphic Labs',
  'Motorway', 'Trainline', 'Zoopla', 'Rightmove', 'Purplebricks', 'Bink', 'Depop', 'Vinted', 'Gymshark', 'Missguided', 'THG', 'Ocado', 'Just Eat',
  'GoCompare', 'MoneySuperMarket', 'Compare the Market', 'Confused.com', 'Uswitch', 'Nested', 'Bloom', 'Papier', 'Farewill', 'Beauty Pie', 'Huel',
  'Mews', 'Duffel', 'TravelPerk', 'Hostmaker', 'Onfido', 'Tray.io', 'Mention Me', 'Pollen', 'Unmind', 'Spill', 'Hinge Health', 'Feather',
  'GitLab', 'MongoDB', 'Databricks', 'Snowflake', 'HashiCorp', 'Twilio', 'Atlassian', 'Canonical', 'Red Hat', 'Sage', 'Xero', 'Iris Software',
];

/** Normalised unique list. */
export function builtInCompanies(): string[] {
  const seen = new Set<string>();
  return UK_FINTECH_STARTUPS.filter((n) => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
