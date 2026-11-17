"""Rebuild the distributable without credentials, journals or Python environments."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
with ZipFile(root / 'public/Scalp_MT5_Connector.zip', 'w', ZIP_DEFLATED) as archive:
    for path in sorted((root / 'connector').iterdir()):
        if path.is_file() and path.suffix in {'.py', '.bat', '.json', '.txt', '.md'}:
            archive.write(path, 'Scalp_MT5_Connector/' + path.name)
print('Connector ZIP rebuilt from authored connector files.')
