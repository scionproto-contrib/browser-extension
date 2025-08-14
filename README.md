# SCION Browser Extension

This is an experimental version of the chromium-based SCION Browser Extension, that can be used to interact with the [SCION Forward Proxy](https://scion-http-proxy.readthedocs.io/en/latest/forward-proxy.html).

Please refer to the [technical documentation](https://scion-browser-extension.readthedocs.io/en/latest/index.html) for installation and configuration instructions.

## Developer setup instructions

1. Install dependencies:
   ```
   npm install -D tailwindcss@2.2.19
   ```

2. Build Tailwind CSS for development (watch mode):
   ```
   npm run watch:css
   ```

3. Build Tailwind CSS for production (minified):
   ```
   npm run build:css
   ```

### Generate AS Name Map
To generate the AS name map, run the following command:
```
   python3 retrieve_as_map.py
```
Copy the contents of `.as_name_map.js` to the "asNameMap" variable in `popup.js`.