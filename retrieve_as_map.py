#!/usr/bin/env python3
"""
Script to download and parse AS numbers from Anapaya documentation.
"""

import requests
from bs4 import BeautifulSoup
import sys

def download_webpage(url):
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        return response.text
    except requests.RequestException as e:
        print(f"Error downloading webpage: {e}")
        sys.exit(1)

def parse_as_data(html_content):
    soup = BeautifulSoup(html_content, 'html.parser')
    
    as_section = None
    for h2 in soup.find_all('h2'):
        if 'Autonomous Systems' in h2.get_text():
            as_section = h2
            break
    
    if not as_section:
        print("Could not find 'Autonomous Systems' section")
        sys.exit(1)
    
    table = as_section.find_next('table', class_='docutils align-default')
    if not table:
        print("Could not find AS table")
        sys.exit(1)
    
    as_map = {}
    tbody = table.find('tbody')
    if tbody:
        for row in tbody.find_all('tr'):
            cells = row.find_all('td')
            if len(cells) >= 2:
                # Extract AS number from first cell
                as_number_elem = cells[0].find('p')
                if as_number_elem:
                    as_number = as_number_elem.get_text().strip()
                    
                    # Extract organization name from second cell
                    org_name_elem = cells[1].find('p')
                    if org_name_elem:
                        org_name = org_name_elem.get_text().strip()
                        
                        if as_number and org_name:
                            as_map[as_number] = org_name
    
    return as_map

def generate_js_snippet(as_map):
    js_content = "const asNameMap = {\n"
    
    sorted_items = sorted(as_map.items(), key=lambda x: int(x[0]) if x[0].isdigit() else float('inf'))
    
    for i, (as_number, name) in enumerate(sorted_items):
        # Escape quotes in the name
        escaped_name = name.replace('"', '\\"')
        js_content += f'    "{as_number}": "{escaped_name}"'
        
        # Add comma if not the last item
        if i < len(sorted_items) - 1:
            js_content += ","
        js_content += "\n"
    
    js_content += "};"
    return js_content

def main():
    url = "https://docs.anapaya.net/en/latest/resources/isd-as-assignments/"
    
    print(f"Downloading webpage from: {url}")
    html_content = download_webpage(url)
    
    print("Parsing AS data...")
    as_map = parse_as_data(html_content)
    
    if not as_map:
        print("No AS data found")
        sys.exit(1)
    
    print(f"Found {len(as_map)} AS entries")
    
    # Generate JavaScript snippet
    js_snippet = generate_js_snippet(as_map)
    
    # Write to file
    output_file = ".as_name_map.js"
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(js_snippet)
    
    print(f"JavaScript snippet written to: {output_file}")
    

if __name__ == "__main__":
    main()