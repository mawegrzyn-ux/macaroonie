// admin/src/routes/menus.jsx: the Menus area's pages (docs/PARALLEL_WORK.md 3.4).
// main.jsx gathers every file in this folder and puts each route under its
// shell: 'office' (AppShell), 'mobile' (MobileShell, /mobile), 'installer'
// (InstallerShell, /install) or 'bare' (no shell). Paths are relative to the
// shell's own path, as they were in main.jsx.

import Allergens from '@/pages/Allergens'
import Menus from '@/pages/Menus'
import MenuVariantGroups from '@/pages/MenuVariantGroups'
import MenuDietaryTags from '@/pages/MenuDietaryTags'
import MenuAllergenMatrix from '@/pages/MenuAllergenMatrix'
import MenuTax from '@/pages/MenuTax'
import MenuTimes from '@/pages/MenuTimes'
import MenuDeliveroo from '@/pages/MenuDeliveroo'
import MenuTranslations from '@/pages/MenuTranslations'
import MenuPrintDesigns from '@/pages/MenuPrintDesigns'
import MenuDesigner from '@/pages/MenuDesigner'
import MobileAllergens from '@/pages/mobile/MobileAllergens'

export const routes = [
  { path: 'allergens', shell: 'office', element: <Allergens /> },
  { path: 'menus', shell: 'office', element: <Menus /> },
  { path: 'menus/variant-groups', shell: 'office', element: <MenuVariantGroups /> },
  { path: 'menus/dietary-tags', shell: 'office', element: <MenuDietaryTags /> },
  { path: 'menus/allergens', shell: 'office', element: <MenuAllergenMatrix /> },
  { path: 'menus/tax', shell: 'office', element: <MenuTax /> },
  { path: 'menus/times', shell: 'office', element: <MenuTimes /> },
  { path: 'menus/deliveroo', shell: 'office', element: <MenuDeliveroo /> },
  { path: 'menus/translations', shell: 'office', element: <MenuTranslations /> },
  { path: 'menus/print-designs', shell: 'office', element: <MenuPrintDesigns /> },
  { path: 'menus/print-designs/:id', shell: 'office', element: <MenuDesigner /> },
  { path: 'allergens', shell: 'mobile', element: <MobileAllergens /> },
]
