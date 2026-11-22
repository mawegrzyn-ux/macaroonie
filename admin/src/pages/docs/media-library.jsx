// src/pages/docs/media-library.jsx
// The Docs page's "Media Library" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono } from './parts.jsx'

export const id = 'media-library'
export const label = 'Media Library'
export const order = 440

export function Section() {
  return (
    <section id="media-library" data-doc="">
      <H2>Media Library</H2>
      <P>
        One component, <Mono>MediaLibraryModal</Mono> in{' '}
        <Mono>components/media/MediaLibrary.jsx</Mono>, serves three uses. As a picker (
        <Mono>mode="picker"</Mono>) it opens as a modal from any image field and returns{' '}
        <Mono>(url, item)</Mono> through <Mono>onPick</Mono>. As a modal manager (
        <Mono>mode="manager"</Mono>) it has no insert action. With <Mono>inline</Mono> it
        fills its container as a page: no backdrop, no close or fullscreen buttons, no footer,
        no Escape handler, and the header gets the <Mono>max-lg:notouch:pl-14</Mono> spacer.
        The sidebar Media link (<Mono>pages/Media.jsx</Mono>, <Mono>/media</Mono>) renders{' '}
        <Mono>{'<MediaLibraryModal open inline mode="manager" />'}</Mono>.
      </P>
      <P>
        The duplicate-upload dialog is <Mono>absolute inset-0</Mono> inside the panel, so the
        panel is <Mono>relative</Mono> in page and fullscreen modes. The image editor is its own{' '}
        <Mono>fixed</Mono> overlay in every mode. API routes live in{' '}
        <Mono>routes/media.js</Mono> (<Mono>/api/media</Mono>).
      </P>
      <P>
        Uploads need website, menus or screens manage. Pictures up to 12 MB; MP4 / WebM videos up
        to 150 MB (migration 167, for menu screens): <Mono>req.parts()</Mono> gets a 150 MB limit
        per call and each part is checked against its own type&apos;s limit, and sharp only reads
        pictures. <Mono>GET /items?kind=image|video</Mono> filters; the picker takes a{' '}
        <Mono>kind</Mono> prop (picker default image, manager all). nginx caps request bodies at
        30 MB, so every deploy runs <Mono>scripts/ensure-nginx-media-upload.sh</Mono>: a regex
        location for the two upload routes (160 MB, request buffering off, 300 s timeouts) before
        each <Mono>location /api/</Mono> block, with that block&apos;s proxy_pass and limit_req;
        idempotent, <Mono>nginx -t</Mono> or restore. <Mono>POST /items/check-duplicate</Mono>{' '}
        returns <Mono>hash</Mono> too.
      </P>
      <P>
        <Mono>.ico</Mono> pictures (favicons) are taken by <Mono>/api/media/items/upload</Mono>,{' '}
        <Mono>/items/:id/replace</Mono> and <Mono>/website/upload</Mono> (kind images):{' '}
        <Mono>utils/icon.js</Mono> takes a file as an icon when the browser calls it{' '}
        <Mono>image/x-icon</Mono> or <Mono>image/vnd.microsoft.icon</Mono>, or gives no useful type
        (<Mono>application/octet-stream</Mono>) and the name ends <Mono>.ico</Mono>
        (<Mono>mayBeIcon()</Mono>); the first bytes must then be an ICO header
        (<Mono>isIcon()</Mono>, else 422) and it is stored as <Mono>image/x-icon</Mono> /{' '}
        <Mono>.ico</Mono>. Media reads its size from the header (<Mono>iconSize()</Mono>, sharp
        can&apos;t read ICO). <Mono>readUpload()</Mono> / <Mono>pictureSize()</Mono> in{' '}
        <Mono>media.js</Mono> serve both of its upload routes. In the admin, the Media
        library&apos;s file filter and <Mono>isImageFile()</Mono> (dropped files) take a typeless
        file named <Mono>.ico</Mono>; the Favicon field&apos;s file picker accepts{' '}
        <Mono>image/*,.ico</Mono>.
      </P>
      <H3>Files dropped onto the editors</H3>
      <P>
        <Mono>lib/fileDrop.js</Mono>: <Mono>useFileDrop()</Mono> (handlers that react only to file
        drags; the innermost area takes the drop), <Mono>uploadMedia()</Mono> (sha-256 in the
        browser, reuses the item with the same hash in that scope through check-duplicate, else
        uploads), <Mono>mediaSize()</Mono> (a picture&apos;s or video&apos;s size, a video&apos;s
        length), <Mono>noImageDrag</Mono> and <Mono>installDropGuard()</Mono> (main.jsx: a drop
        nothing takes is cancelled with dropEffect none, so the browser never opens the file over
        the admin; inputs and contenteditable keep their own drops).{' '}
        <Mono>components/FileDropArea.jsx</Mono> wraps a picture field. Where it is used: the board
        designer canvas (onto an image / video block replaces its url, else a new block at the drop
        point the file&apos;s shape; videos get <Mono>opts.duration</Mono>), the menu designer pages
        (onto an image block, else a new image block at the grid cell), the page builder canvas
        (onto image / hero / story_with_stamp, <Mono>PICTURE_FIELD</Mono> in PageBuilder.jsx, else
        a new Image block after the block dropped on; uploads through <Mono>/website/upload</Mono>),
        both website <Mono>ImageField</Mono>s, the designers&apos; picture panels and the Menus
        page dish / section pictures. In both designers the canvas cancels <Mono>dragstart</Mono>{' '}
        and the blocks are <Mono>user-select: none</Mono> / <Mono>-webkit-touch-callout: none</Mono>:
        the browser&apos;s own picture drag used to start on a mouse press on a picture, cancel the
        pointer move (pointercancel) and leave the block where it was.
      </P>
    </section>
  )
}
