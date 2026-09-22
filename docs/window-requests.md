# Window requests and local previews

Requires SDK 3.1 and a Talos version supporting window requests.

```tsx
import { talos } from '@thom1606/talos-sdk';
import MyWindow from './windows/my-window';

export function activate() {
  talos.openWindow({
    title: 'My tool',
    children: <MyWindow />,
    onRequest: async (method, payload, context, signal) => {
      // Runs in the Node extension, with this window's original activation context.
      // Validate the method and payload. Pass signal to cancellable work/subprocesses.
      if (method !== 'inspect') throw new Error('Unknown operation');
      signal.throwIfAborted();
      return { names: context.files.map(file => file.name) };
    },
  });
}
```

Inside the imported React component:

```tsx
import { useTalos } from '@thom1606/talos-sdk/react';
import { talosWindow } from '@thom1606/talos-sdk/window';

const result = await talosWindow.invoke<{ names: string[] }>('inspect', null);
// In a component:
const { files } = useTalos();
const localURL = talosWindow.fileURL(files[0]); // img, video, audio, etc.
```

Requests and responses must be JSON serializable and each fit in 32 KB. This channel is for commands
and results, not file bytes. Use `readFile` / `saveFile` for browser file data, or handle files in the
Node extension. A request cannot reach another extension or a previous runtime session.
Closing the window, unloading the extension or a 30-minute timeout aborts its handler signal.
At most 16 requests may be outstanding per window. Honor cancellation in your handler; it is cooperative.

`fileURL` only accepts activation files from the current window. It supports byte-range streaming and
reveals no filesystem URL. Local previews do not permit network access. The URL expires with the window.
No media processing or codecs are supplied by Talos; those remain extension dependencies.
