# Development instructions

* No unit tests exist, so you do not need to run any test commands.
* If you change code that affects the compiled `.vsix`, increment the `version` field in `package.json`.
* Check the latest release tag with `git tag` and remove the leading `v`. The `package.json` version must be greater than or equal to that tag.
* Choose a patch, minor or major version bump depending on the scale of your changes.
