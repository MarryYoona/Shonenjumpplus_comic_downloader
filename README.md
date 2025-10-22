# Shonenjumpplus\_comic\_downloader

A userscript for downloading comics from the Shonen Jump+ platform, featuring image restoration and batch download capabilities.

## Features

*   Automatically extracts comic chapter image data
*   Supports split image restoration (for specific encrypted formats)
*   Provides single/batch image download functions
*   Built-in image preview and operation panel

## Supported Sites

`https://shonenjumpplus.com/episode/*`

## Usage Steps

1.  Install a userscript manager (e.g., Tampermonkey)
2.  Install this script
3.  Visit a supported comic chapter page
4.  An operation panel will appear on the right side of the page for restoration, preview, and download operations

## Supported Resolutions

*   760×1200
*   764×1200
*   822×1200
*   844×1200

## Permission Explanations

*   `GM_addStyle`: Used to inject styles and build the operation interface
*   `GM_download`: Used to implement the image download function
