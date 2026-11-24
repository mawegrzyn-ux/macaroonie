// src/pages/mobile/MobileDevice.jsx
//
// This device on the phone (/mobile/device): the person's own office PIN,
// and marking this phone or tablet as shared for a venue (migration 280).
// The same cards as the office's Settings page.

import { SharedDeviceSettings, OfficePinSettings } from '@/components/SharedDevice'

export default function MobileDevice() {
  return (
    <div className="p-3 pb-24 space-y-3">
      <OfficePinSettings />
      <SharedDeviceSettings />
    </div>
  )
}
