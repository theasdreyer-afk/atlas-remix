import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

FILES = [
    'src/01-head.html',
    'src/02-styles-full.html',
    'src/03-head-scripts.html',
    'src/04-body-structure.html',
    'src/05-script-header.html',
    'src/legis-2024.js',
    'data/insee-cache.js',
    'data/geo-cache.js',
    'data/communes.js',
    'src/06-main-logic.js',
    'src/06-overlay-logic.js',
    'src/07-html-misc.html',
    'src/08-sidebar-scroll.html',
    'src/09-arr-overlay.html',
    'src/10-epci-overlay.html',
    'src/11-circo-overlay.html',
    'src/14-bv-geojson.html',
    'src/15-bv-polygones.html',
    'src/16-final-scripts.html',
    'src/17-analyse-tab.js',
    'src/18-aac-data.html',
    'src/19-aac-tab.js',
    'src/20-overlay-tab.html',
    'src/21-flyer-tab.js',
    'src/17-closing.html'
]

def build():
    final_html = ""
    for file_path in FILES:
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                if file_path.endswith('.js'):
                    final_html += f"<script>\n{content}\n</script>\n"
                else:
                    final_html += content + "\n"
        else:
            print(f"Warning: File not found: {file_path}")
    
    output_path = os.path.abspath('atlas.hugo.dreyer.html')
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(final_html)
    print(f"Build complete: {output_path}")
    input("Appuyez sur Entrée pour fermer...")

if __name__ == "__main__":
    build()
