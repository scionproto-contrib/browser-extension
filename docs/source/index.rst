SCION Browser Extension
=======================

The SCION browser extension is a tool that provides access to HTTP(S) resources via SCION for chromium-based browsers.
You can find the source code on https://github.com/scionproto-contrib/browser-extension.

The SCION browser extension is part of a broader group of `SCION Applications <https://docs.scion.org/projects/scion-applications/en/latest>`_ .

.. note::
    We are currently using Manifest V2 for the extension. 
    We are aware that V2 is getting `deprecated <https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline>`_ in Chrome.  
    However, the SCION-strict navigation would likely be impacted if we migrate to Manifest V3. 
    Other chromium-based browsers, like Brave, are demonstrating some resistance to the Manifest V3 migration and `still support V2 <https://brave.com/blog/brave-shields-manifest-v3/>`_ by default.
    On Chrome, one can also temporarily allow Manifest V2 https://chromeenterprise.google/policies/#ExtensionManifestV2Availability.

.. note::
    Nonetheless, we consider migrating to Manifest V3 in the future and/or support Firefox.

If you have any questions or need help, please `contact us <https://docs.scion.org/projects/scion-applications/en/latest/#contact-us>`_.


Requirements
------------

The extension interacts with the `SCION HTTP Forward Proxy <https://scion-http-proxy.readthedocs.io/en/latest/forward-proxy.html>`_ to fetch resources via SCION.
As stated in the documentatin, the SCION HTTP Forward Proxy can be connected to either the SCION production network, e.g., being part of the `SCIERA ISD <https://sciera.readthedocs.io/en/latest/>`_ or
it can be part of the `SCIONLab network <https://www.scionlab.org/>`_, e.g., you are running your own SCIONLab AS and have already set uo the `SCION HTTP Forward Proxy <https://scion-http-proxy.readthedocs.io/en/latest/forward-proxy.html>`_ .

More information on the different SCION networks and how to access them can be found at https://docs.scion.org/projects/scion-applications/en/latest/applications/access.html 

In-network Proxy mode
~~~~~~~~~~~~~~~~~~~~~

If your network domain offers an in-network proxy, double check with your network administrator to connect to it. 

.. note::
    At the moment, it is likely that you need some manual configuration. We are working on a more user-friendly solution that network operators can implement.

.. note::
    If your network is part of the `SCIERA ISD <https://sciera.readthedocs.io/en/latest/>`_, you can also try to `contact us <https://docs.scion.org/projects/scion-applications/en/latest/#contact-us>`_.
    Please specify ``HTTP-Proxy`` as the subject of the email.

Self-hosted Proxy option
~~~~~~~~~~~~~~~~~~~~~~~~

If you rather prefer to run your own proxy, you can follow the instructions in the `documentation <https://scion-http-proxy.readthedocs.io/en/latest/forward-proxy.html#running-the-scion-http-forward-proxy-locally>`__.
Please note that for the latter, you will need to follow the instructions to enable a SCION endhost stack on your machine. 
The `documentation <https://scion-http-proxy.readthedocs.io/en/latest/forward-proxy.html#prerequisites>`__ provides a detailed guide on how to set it up.

Installation
------------

At the moment, we support only chromium based browsers (e.g. Chrome, Brave), other browsers will follow. 
To install the browser extension, clone the `Github <https://github.com/scionproto-contrib/browser-extension>`_ repository or download and unzip the `latest release <https://github.com/scionproto-contrib/browser-extension/releases>`_.

Then navigate to `Extensions->Manage Extensions`. 
On the upper right corner, enable `Developer Mode`. Then click the `Load unpacked` button and select the ``/chrome`` folder in the unzipped folder.


.. note::
    The error indicating that the manifest is deprecated does not impact the functionality at the moment, if you turn the extension on. 
    If you are using Chrome or Chromium, you can temporarily allow Manifest V2 https://chromeenterprise.google/policies/#ExtensionManifestV2Availability.

Usage
-----

The SCION Browser Extension can work in two modes: In the default mode, the extension loads resources via SCION for SCION-enabled domains and for the rest, it loads them via BGP/IP.

.. image:: images/default_extension.png
    :alt: Default

In the strict mode, only resources from SCION-enabled domains are loaded.

.. image:: images/strict_extension.png
    :alt: Strict

Geofencing (Whitelisting)
-------------------------

To configure the ISD whitelist, press the `Options` button. SCION traffic will traverse only those ASes that have been enabled using the toggle button.

.. image:: images/geofence_options.png
    :alt: Geofence options

Path usage information
-----------------------

The extension provides path information to the user about the path used during the connection.
It provides visual information about the ISD traversed, the exchanged data amount and detailed information about the traversed ASes.

.. note::
    At the moment, path information is only available if you have previously configured geofencing policies for the extension.
    One can configure the "Allow all traffic" option to see the path information, while allowing traffic to any ISD.
    This is due to security concerns, although it is not a future compromise.

.. image:: images/path_usage_extension.png
    :alt: Path usage

SCION enabled domains
--------------------------

Please check the `SCION enabled domains <https://scion-http-proxy.readthedocs.io/en/latest/forward-proxy.html#scion-enabled-domains>`_ for a list of domains that are SCION-enabled.