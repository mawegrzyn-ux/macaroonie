# Wire Brand layout into Website.jsx

In `admin/src/pages/Website.jsx`:

1. Add import:

```js
import { BrandLayoutSection } from '@/components/website-builder/BrandLayoutSection'
```

2. In `TenantActiveSection`, change `tenant-brand` to:

```js
    case 'tenant-brand':     return (
      <div className="space-y-6">
        <BrandIdentitySection />
        <BrandThemeSection />
        <BrandLayoutSection />
      </div>
    )
```
