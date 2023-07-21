#!/bin/bash

for icon in ./raw/*.svg; do
    convert \
        -background none \
        -fill azure4 \
        -colorize 100 \
        -resize 48x48 \
        -gravity center \
        -extent 48x48 \
        "$icon" \
        ./rendered/"$(basename "$icon").png"
done
