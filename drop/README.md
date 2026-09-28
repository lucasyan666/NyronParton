# Drop folder

Put any images here, then run:

    npm run photos:scan

Every image is compressed into `public/photos/`, measured for its true aspect
ratio, and dealt into rooms of 12. Restart the dev server and walk through them.

Names, formats and sizes do not matter — nothing needs renaming first.

To go back to the built-in demo exhibition:

    rm data/generated.json
