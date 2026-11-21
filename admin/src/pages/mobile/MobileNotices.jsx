// src/pages/mobile/MobileNotices.jsx
//
// Notices on the phone (/mobile/notices): turn push notices on for this
// phone and choose what comes (migration 262). The same NoticeSettings as
// the office's Settings page.

import NoticeSettings from '@/components/notices/NoticeSettings'

export default function MobileNotices() {
  return (
    <div className="p-3 pb-8">
      <NoticeSettings />
    </div>
  )
}
