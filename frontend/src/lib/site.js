/**
 * Where the public pages send people who need a human.
 *
 * One constant rather than an address typed into each page, so changing the inbox is a
 * one-line edit and the Contact, Support and FAQ pages cannot drift apart.
 */
export const SUPPORT_EMAIL = 'support@evidenceiq.app'

// The footer's columns. Product items are sections of the landing page; the rest are
// pages of their own. The navbar uses the same split.
export const FOOTER_COLUMNS = [
  {
    heading: 'Product',
    links: [
      { label: 'How It Works', to: '/#how-it-works' },
      { label: 'Features', to: '/#features' },
      { label: 'Pricing', to: '/#pricing' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Documentation', to: '/docs' },
      { label: 'FAQ', to: '/faq' },
      { label: 'Support', to: '/support' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Contact', to: '/contact' },
    ],
  },
]
