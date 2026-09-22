# Jian app icon

`AppIcon.svg` is the macOS source. `Jian.icns` and `Jian.iconset` are ready to use.
`exports/` contains 16, 32, 64, 128, 256, 512 and 1024 point images at 1× and 2×
(up to 2048 pixels). Small exports omit the frame to keep the bird legible.

The Xcode catalog in `../Jian/Assets.xcassets/AppIcon.appiconset` uses Apple's macOS
slots: 16, 32, 128, 256 and 512 points at both scales. Its 32pt @2x and 512pt @2x
files supply 64px and 1024px. The iOS slot has an opaque 1024px icon.

Regenerate from the repository root:

```bash
pnpm --filter @jian/gateway-ui brand:generate
```

The same command writes the web logos and README banner to
`apps/gateway-ui/public/brand`. `iconutil` generates the `.icns` on macOS.
