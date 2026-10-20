// src/pages/Brand.jsx
//
// Brand & theme (/brand): the group's brand, used by more than the website.
// The brand name, tagline, logo and favicon, the colours and fonts (with
// theme ideas and the theme maker), and Use the brand on other designs
// (components/brand/ApplyBrand.jsx). Stored on tenant_site like before
// (/website/brand-defaults), so the website shows changes after it is
// published; every designer's colour swatches (/api/me site_theme) and Use
// the brand button read it straight away. A location's own website look
// stays in Website > Look & layout. Changes need Website manage.

import { Link } from 'react-router-dom'
import { Palette, Globe } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import { BrandIdentitySection, BrandThemeSection } from '@/pages/Website'
import { ApplyBrandCard } from '@/components/brand/ApplyBrand'

export default function Brand() {
  const { canManage } = usePermission('website')
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 sm:p-6 max-lg:notouch:pl-14 max-w-4xl mx-auto space-y-5" data-testid="brand-page">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Palette className="w-5 h-5 text-primary" /> Brand &amp; theme</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your logo, colours and fonts. The website uses them, every designer offers them (kiosks, menu screens,
            printed menus), and below you can put them on those designs in one go.
          </p>
        </div>
        {!canManage && <ReadOnlyNotice what="the brand" />}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-background px-4 py-3 text-sm" data-testid="brand-publish-note">
          <Globe className="w-4 h-4 text-primary shrink-0" />
          <span className="flex-1 min-w-[220px]">The website shows brand changes once it is published.</span>
          <Link to="/website" className="min-h-[44px] px-3 rounded-md border text-sm font-medium inline-flex items-center touch-manipulation hover:bg-muted">
            Website and Publish
          </Link>
        </div>
        <ReadOnlyFieldset disabled={!canManage} className="space-y-5">
          <BrandIdentitySection part="brand" />
          <BrandThemeSection />
        </ReadOnlyFieldset>
        <ApplyBrandCard />
      </div>
    </div>
  )
}
