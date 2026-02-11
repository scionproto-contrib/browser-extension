# SCION Browser Extension

This is an experimental version of the chromium-based SCION Browser Extension, that can be used to interact with the [SCION Forward Proxy](https://scion-http-proxy.readthedocs.io/en/latest/forward-proxy.html).

Please refer to the [technical documentation](https://scion-browser-extension.readthedocs.io/en/latest/index.html) for installation and configuration instructions.

## Developer setup instructions

1. Install dependencies (run in the root folder):
    ```
    npm install -D tailwindcss@2.2.19
    ```

2. Build Tailwind CSS for development (watch mode) (run in the root folder):
    ```
    npm run watch:css
    ```

3. Build Tailwind CSS for production (minified) (run in the root folder):
    ```
    npm run build:css
    ```
   
4. Install modules for TypeScript (run in the `core` folder):
    ```shell
    npm install
    ```

5. To use the extension, run within the `core` folder:
    ```shell
    npm run build
    ```
   
    This will write the output into `core/dist/<browser>` which is the folder that can be
    selected when loading the unpacked extension.

### Firefox-only settings
For the extension to work properly, it must be allowed to change the proxy which requires
the permission to run in private windows. This can be enabled as follows: 
- enter `about:addons` in the address bar
- selecting the `SCION Browser Extension`
- switching `Run in Private Windows` to `Allow`

### Generate AS Name Map
To generate the AS name map, run the following command:
```
   python3 retrieve_as_map.py
```
Copy the contents of `.as_name_map.js` to the "asNameMap" variable in `popup.js`.