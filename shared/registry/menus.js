// shared/registry/menus.js: the Menus area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'menu.menus', label: 'Menu', plural: 'Menus', words: ['menu publish', 'release'],
    table: 'menus', subjects: ['menu.menus', 'menu.releases'],
    page: '/menus',
    actions: ['create_menu', 'update_menu', 'duplicate_menu', 'publish_menu', 'cancel_menu_publish'],
  },
  {
    key: 'menu.sections', label: 'Menu section', plural: 'Menu sections', words: ['menu category'],
    table: 'menu_sections', subjects: ['menu.sections'],
    page: '/menus',
    actions: ['update_section', 'remove_section'],
  },
  {
    key: 'menu.dishes', label: 'Dish', plural: 'Dishes', words: ['menu item', 'product', 'price'],
    table: 'menu_items',
    subjects: ['menu.dishes', 'menu.dish_tags', 'menu.dish_option_groups', 'menu.dish_option_prices', 'menu.dish_own_options'],
    page: '/menus',
    actions: ['add_dishes', 'update_dish', 'remove_dishes', 'change_prices'],
  },
  {
    key: 'menu.option_groups', label: 'Option group', plural: 'Option groups', words: ['variant group', 'modifier', 'options'],
    table: 'menu_variant_groups', subjects: ['menu.option_groups', 'menu.options'],
    page: '/menus/variant-groups',
  },
  {
    key: 'menu.tags', label: 'Allergen or dietary tag', plural: 'Allergens and dietary tags', words: ['allergen', 'dietary tag'],
    table: 'menu_dietary_tags', subjects: ['menu.tags'],
    page: '/menus/allergens',
  },
  {
    key: 'menu.tax_rates', label: 'Tax rate', plural: 'Tax rates', words: ['vat rate'],
    table: 'tax_rates', subjects: ['menu.tax_rates'],
    page: '/menus/tax',
  },
]
