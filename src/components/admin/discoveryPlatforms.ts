/**
 * Platform presets for Lead discovery. Each one is saved as a custom feature ({label, keywords})
 * in config.custom_features: the first keyword is added to the search query, and all keywords
 * are looked for in the page HTML to confirm the platform (043).
 */
export interface PlatformPreset { group: string; label: string; keywords: string[] }

export const PLATFORM_GROUPS_EN: Record<string, string> = {
  'متاجر إلكترونية': 'Online stores',
  'بناء مواقع': 'Website builders',
  'أنظمة CMS': 'CMS & frameworks',
};

export const PLATFORM_PRESETS: PlatformPreset[] = [
  // متاجر إلكترونية
  { group: 'متاجر إلكترونية', label: 'سلة (Salla)', keywords: ['salla', 'cdn.salla.sa', 'salla.sa', 'salla.network', 'powered by salla'] },
  { group: 'متاجر إلكترونية', label: 'زد (Zid)', keywords: ['zid', 'zid.store', 'cdn.zid.store', 'zid.sa', 'web.zid'] },
  { group: 'متاجر إلكترونية', label: 'Shopify', keywords: ['shopify', 'cdn.shopify.com', 'myshopify.com', 'shopify.theme'] },
  { group: 'متاجر إلكترونية', label: 'WooCommerce', keywords: ['woocommerce', 'wp-content/plugins/woocommerce', 'wc-ajax', 'woocommerce-'] },
  { group: 'متاجر إلكترونية', label: 'ExpandCart', keywords: ['expandcart', 'expandcart.com', 'cdn.expandcart'] },
  { group: 'متاجر إلكترونية', label: 'Magento', keywords: ['magento', 'mage/cookies', 'static/frontend', 'Magento_'] },
  { group: 'متاجر إلكترونية', label: 'PrestaShop', keywords: ['prestashop', 'content="PrestaShop"', '/modules/ps_'] },
  { group: 'متاجر إلكترونية', label: 'OpenCart', keywords: ['opencart', 'index.php?route=', 'catalog/view/theme'] },
  { group: 'متاجر إلكترونية', label: 'Ecwid', keywords: ['ecwid', 'app.ecwid.com'] },
  { group: 'متاجر إلكترونية', label: 'BigCommerce', keywords: ['bigcommerce', 'cdn11.bigcommerce.com'] },
  { group: 'متاجر إلكترونية', label: 'Easy Orders', keywords: ['easyorders', 'easy-orders'] },
  { group: 'متاجر إلكترونية', label: 'Youcan', keywords: ['youcan', 'youcan.shop', 'cdn.youcan'] },
  // بناء مواقع
  { group: 'بناء مواقع', label: 'Wix', keywords: ['wix', 'wixstatic.com', 'wixsite.com', 'static.parastorage.com'] },
  { group: 'بناء مواقع', label: 'Squarespace', keywords: ['squarespace', 'static1.squarespace.com', 'squarespace-cdn'] },
  { group: 'بناء مواقع', label: 'Webflow', keywords: ['webflow', 'assets.website-files.com', 'data-wf-site'] },
  { group: 'بناء مواقع', label: 'Elementor', keywords: ['elementor', 'wp-content/plugins/elementor', 'elementor-'] },
  { group: 'بناء مواقع', label: 'GoDaddy Builder', keywords: ['godaddy website builder', 'img1.wsimg.com', 'wsimg.com'] },
  { group: 'بناء مواقع', label: 'Tilda', keywords: ['tilda', 'tildacdn.com'] },
  { group: 'بناء مواقع', label: 'Weebly', keywords: ['weebly', 'editmysite.com'] },
  { group: 'بناء مواقع', label: 'Blogger', keywords: ['blogger', 'blogspot.com', 'blogger.com'] },
  // CMS وأنظمة
  { group: 'أنظمة CMS', label: 'Joomla', keywords: ['joomla', '/media/jui/', 'content="Joomla'] },
  { group: 'أنظمة CMS', label: 'Drupal', keywords: ['drupal', 'sites/default/files', 'content="Drupal'] },
  { group: 'أنظمة CMS', label: 'Odoo', keywords: ['odoo', '/web/static/', 'content="Odoo"'] },
  { group: 'أنظمة CMS', label: 'Laravel / PHP مخصص', keywords: ['laravel_session', 'csrf-token', 'laravel'] },
  { group: 'أنظمة CMS', label: 'React / Next.js', keywords: ['next.js', '_next/static', '__next', 'react'] },
  { group: 'أنظمة CMS', label: 'Ghost', keywords: ['ghost', 'content="Ghost', 'ghost.io'] },
];
