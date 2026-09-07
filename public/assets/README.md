# Drop your images here

Two files, exact names:

| file | where it appears |
|---|---|
| `avatar.png` | the agent's face — header, next to the name |
| `banner.png` | hero background behind the header, and the empty-state showcase |

`.jpg`, `.gif`, `.webp` and `.svg` also work if you rename the extension in
`ASSETS` at the bottom of `public/index.html`.

Until they exist the UI shows a labelled placeholder rather than a broken image,
so nothing looks wrong before you've added them.

Only image types are served, by bare filename, from this directory only.
