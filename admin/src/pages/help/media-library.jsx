// src/pages/help/media-library.jsx
// The Help page's "Media Library" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'media-library'
export const label = 'Media Library'
export const order = 480

// ── MEDIA LIBRARY ────────────────────────────────
export function Section() {
  return (
    <section id="media-library" data-help="">
      <H2>Media Library</H2>
      <P>
        The <strong>Media</strong> page (sidebar, under Website) is your tenant&apos;s
        shared image library. Every image uploaded anywhere in the platform — hero
        shots, brand logos, gallery photos, OG images — is stored here and can be
        picked again from any image field via the new <strong>Choose from library</strong>
        button.
      </P>

      <H3>Two ways to use it</H3>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>
          <strong>Picker</strong> — opens automatically when you click "Choose from library"
          next to any image field on the website builder, brand defaults, etc.
          Pick one image and click <strong>Insert selected</strong> — the field gets the URL.
        </li>
        <li>
          <strong>Manager</strong> — open <strong>Media</strong> from the sidebar to browse,
          rename, recategorise, or bulk-delete without being mid-task. It opens as a normal
          page; use the sidebar to leave it.
        </li>
      </ol>

      <H3>Categories</H3>
      <P>
        User-defined flat tags. Create them from the sidebar (&ldquo;+ New category&rdquo;).
        Hover a category to rename or delete. Deleting a category does NOT delete its
        items — they just become uncategorised.
      </P>

      <H3>Scope (form filter)</H3>
      <P>
        Each image is tagged with a <strong>scope</strong> — either &ldquo;shared&rdquo;
        (global library) or a specific form key like <code className="font-mono">website:hero</code>.
        The Form filter dropdown lets you see only images for a particular form, or all.
        Use <strong>Move to scope</strong> in the detail panel to promote an image from
        form-specific to shared (so it can be reused anywhere).
      </P>

      <H3>Upload</H3>
      <ul className="list-disc ml-5 space-y-1 text-sm text-muted-foreground mb-4">
        <li>Click <strong>Upload</strong> in the sidebar to pick files.</li>
        <li>Or drag image files anywhere onto the modal.</li>
        <li>Multiple files at once is fine; each gets its own progress chip.</li>
        <li>If a file with the same name (or identical contents) exists in the same scope, you&apos;ll be asked: <strong>Replace</strong> / <strong>Keep both</strong> / <strong>Cancel</strong>.</li>
        <li>Set <strong>Upload to</strong> in the sidebar before uploading to auto-tag new files into a category.</li>
      </ul>

      <H3>Multi-select</H3>
      <P>
        Hover a thumbnail to reveal its checkbox; or hold ⌘/Ctrl/Shift while clicking to
        add to selection. The right panel switches to bulk actions: move category, move
        scope, delete all.
      </P>

      <H3>Image editor</H3>
      <P>
        Click <strong>Edit image</strong> in the detail panel to open the editor.
        You can crop (with aspect ratio presets — Free / 1:1 / 4:3 / 3:2 / 16:9 / 9:16),
        rotate in 90° increments, and flip horizontally or vertically.
      </P>
      <P>
        Two ways to save:
      </P>
      <ul className="list-disc ml-5 space-y-1 text-sm text-muted-foreground mb-4">
        <li><strong>Save as new</strong> — creates a fresh image (with a "-edited" suffix on the filename) so the original stays untouched.</li>
        <li><strong>Replace original</strong> — overwrites the file behind the item. References to it elsewhere (hero images, brand defaults) instantly use the edited version.</li>
      </ul>
      <InfoBox type="info">
        Brightness, contrast, and other adjustments aren&apos;t in this release —
        just crop / rotate / flip for now. If you need colour adjustments,
        edit the file in your image tool of choice and re-upload.
      </InfoBox>
    </section>
  )
}
