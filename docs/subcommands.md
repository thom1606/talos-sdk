# Wheel subcommands

An action can declare `subcommands`, an ordered list of other command names in the same package.
Talos presents them using its existing wheel folder navigation. No window or `activate` call is made
for the parent; dropping on a leaf calls `activate` with that leaf's name in `context.action`.

```json
[
  { "name": "convert", "displayName": "Convert", "supportedFileTypes": ["public.image", "public.movie"], "subcommands": ["convert-png", "convert-mp4"] },
  { "name": "convert-png", "displayName": "PNG", "supportedFileTypes": ["public.image"] },
  { "name": "convert-mp4", "displayName": "MP4", "supportedFileTypes": ["public.movie"] }
]
```

Children must support every selected file to appear. An empty submenu is hidden, so the example
also rejects a mixed image/video selection. Referenced commands do not appear separately in the root
Settings palette. Cycles, missing references and nesting beyond eight levels fail package validation.
Requires SDK 3.2 and a Talos app with submenu support.
