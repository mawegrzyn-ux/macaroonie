# Menus can sell food, retail goods or services

- A menu's Settings has **What this menu sells**: Food and drink (every menu to start with), Retail goods or Services. A section or a dish can say otherwise; the most specific wins, as with tax.
- A dish that isn't food hides allergens, diet tags and calories in its panel. Anything already set is kept if you switch back. Sections and dishes that aren't food show Retail or Service next to their name.
- The type goes live when the menu is published. Allergen screens, the kiosk, the till and kitchen screens don't use it yet (the next steps).
- Migration 267 (`menus.item_type`, `menu_sections.item_type`, `menu_items.item_type`).
