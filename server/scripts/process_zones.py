#!/usr/bin/env python3
import os
import sys
import json
import csv
import re
import urllib.request
import tempfile
import xml.etree.ElementTree as ET
import pandas as pd
import shapefile
from shapely.geometry import shape, Point, Polygon, MultiPolygon, mapping
from shapely.ops import transform
import shapely.wkt
import pyproj

# Output directory for unified zones
OUTPUT_DIR = "/Users/andrewpham/Documents/GitHub/au-rea-insights/server/data/school-zones"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Pyproj coordinate transformer for TAS (MGA Zone 55 -> WGS84)
tas_transformer = pyproj.Transformer.from_crs("epsg:28355", "epsg:4326", always_xy=True)

def process_and_simplify(geom, tolerance=0.0002):
    """Simplifies the geometry to keep file sizes low while retaining accuracy."""
    simplified = geom.simplify(tolerance, preserve_topology=True)
    if not simplified.is_valid:
        simplified = geom
    return simplified

def build_feature(school_name, school_type, state_code, geom):
    """Formats shapely geometry and properties into a standard GeoJSON feature."""
    simplified_geom = process_and_simplify(geom)
    centroid = geom.centroid
    return {
        "type": "Feature",
        "geometry": mapping(simplified_geom),
        "properties": {
            "schoolName": school_name.strip(),
            "type": school_type,
            "state": state_code.upper(),
            "centroid": [centroid.x, centroid.y]
        }
    }

def save_geojson(features, filename):
    filepath = os.path.join(OUTPUT_DIR, filename)
    geojson_data = {
        "type": "FeatureCollection",
        "features": features
    }
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(geojson_data, f, ensure_ascii=False)
    print(f"Saved {len(features)} features to {filepath} (Size: {os.path.getsize(filepath) / (1024*1024):.2f} MB)")

def parse_kml_coordinates(coords_str):
    coords = []
    cleaned = coords_str.replace('\r', ' ').replace('\n', ' ').replace('\t', ' ')
    for pt in cleaned.split():
        parts = pt.split(',')
        if len(parts) >= 2:
            try:
                coords.append((float(parts[0]), float(parts[1])))
            except ValueError:
                pass
    return coords

def find_all_by_suffix(element, suffix):
    results = []
    for child in element.iter():
        if child.tag.endswith(suffix):
            results.append(child)
    return results

def parse_kml_file(kml_path):
    """Parses KML file (namespace-agnostic) and returns a list of (school_name, geom) tuples."""
    try:
        tree = ET.parse(kml_path)
    except Exception as e:
        print(f"Error parsing XML file {kml_path}: {e}")
        return []
    
    root = tree.getroot()
    all_placemarks = find_all_by_suffix(root, 'Placemark')
    features = []
    
    for pm in all_placemarks:
        name_node = next((c for c in pm if c.tag.endswith('name')), None)
        name = name_node.text.strip() if name_node is not None and name_node.text else "Unknown"
        
        # Look for Polygons
        polygons = find_all_by_suffix(pm, 'Polygon')
        for poly in polygons:
            outer_boundary = find_all_by_suffix(poly, 'outerBoundaryIs')
            if not outer_boundary:
                continue
            ring = find_all_by_suffix(outer_boundary[0], 'LinearRing')
            if not ring:
                continue
            coords_node = next((c for c in ring[0] if c.tag.endswith('coordinates')), None)
            if coords_node is None or not coords_node.text:
                continue
            
            outer_coords = parse_kml_coordinates(coords_node.text)
            if len(outer_coords) < 3:
                continue
                
            # Inner boundaries (holes)
            holes = []
            inner_boundaries = find_all_by_suffix(poly, 'innerBoundaryIs')
            for inner in inner_boundaries:
                iring = find_all_by_suffix(inner, 'LinearRing')
                if not iring:
                    continue
                icoords_node = next((c for c in iring[0] if c.tag.endswith('coordinates')), None)
                if icoords_node is not None and icoords_node.text:
                    icoords = parse_kml_coordinates(icoords_node.text)
                    if len(icoords) >= 3:
                        holes.append(icoords)
            
            try:
                poly_geom = Polygon(outer_coords, holes)
                features.append((name, poly_geom))
            except Exception as ex:
                pass
    return features

# -----------------------------------------------------------------------------
# VIC
# -----------------------------------------------------------------------------
def process_vic():
    print("--- Processing VIC ---")
    vic_dir = "/Users/andrewpham/Documents/GitHub/au-rea-insights/source_files/VIC/dv419_DataVic_School_Zones_2027_MAR26"
    
    # 1. Primary
    primary_path = os.path.join(vic_dir, "Primary_Integrated_2027.geojson")
    primary_features = []
    if os.path.exists(primary_path):
        with open(primary_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            for feat in data.get('features', []):
                name = feat['properties'].get('School_Name', 'Unknown')
                geom = shape(feat['geometry'])
                primary_features.append(build_feature(name, "Primary", "VIC", geom))
        save_geojson(primary_features, "vic_primary.json")
    
    # 2. Secondary (Combine Year 7 and Standalone zones)
    secondary_features = []
    sec_files = [
        "Secondary_Integrated_Year7_2027.geojson",
        "Standalone_juniorsec_2027.geojson",
        "Standalone_seniorsec_2027.geojson",
        "Standalone_singlesex_2027.geojson"
    ]
    seen_sec_schools = set()
    for fname in sec_files:
        fpath = os.path.join(vic_dir, fname)
        if os.path.exists(fpath):
            with open(fpath, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for feat in data.get('features', []):
                    name = feat['properties'].get('School_Name', 'Unknown')
                    # De-duplicate secondary zones to keep sizes smaller
                    key = name.lower().strip()
                    if key not in seen_sec_schools:
                        seen_sec_schools.add(key)
                        geom = shape(feat['geometry'])
                        secondary_features.append(build_feature(name, "Secondary", "VIC", geom))
    save_geojson(secondary_features, "vic_secondary.json")

# -----------------------------------------------------------------------------
# NSW
# -----------------------------------------------------------------------------
def process_nsw():
    print("--- Processing NSW ---")
    nsw_dir = "/Users/andrewpham/Documents/GitHub/au-rea-insights/source_files/NSW/catchments"
    
    # Primary
    prim_path = os.path.join(nsw_dir, "catchments_primary.shp")
    if os.path.exists(prim_path):
        sf = shapefile.Reader(prim_path)
        fields = [f[0] for f in sf.fields[1:]]
        features = []
        for sr in sf.shapeRecords():
            record = dict(zip(fields, sr.record))
            name = record.get('USE_DESC', 'Unknown')
            geom = shape(sr.shape.__geo_interface__)
            features.append(build_feature(name, "Primary", "NSW", geom))
        save_geojson(features, "nsw_primary.json")
        
    # Secondary
    sec_path = os.path.join(nsw_dir, "catchments_secondary.shp")
    if os.path.exists(sec_path):
        sf = shapefile.Reader(sec_path)
        fields = [f[0] for f in sf.fields[1:]]
        features = []
        for sr in sf.shapeRecords():
            record = dict(zip(fields, sr.record))
            name = record.get('USE_DESC', 'Unknown')
            geom = shape(sr.shape.__geo_interface__)
            features.append(build_feature(name, "Secondary", "NSW", geom))
        save_geojson(features, "nsw_secondary.json")

# -----------------------------------------------------------------------------
# QLD
# -----------------------------------------------------------------------------
def process_qld():
    print("--- Processing QLD ---")
    qld_dir = "/Users/andrewpham/Documents/GitHub/au-rea-insights/source_files/QLD"
    
    # Primary
    prim_path = os.path.join(qld_dir, "QLD-primary_catchments_2026.kml")
    if os.path.exists(prim_path):
        kml_feats = parse_kml_file(prim_path)
        features = [build_feature(name, "Primary", "QLD", geom) for name, geom in kml_feats]
        save_geojson(features, "qld_primary.json")
        
    # Secondary (Merge junior and senior secondary catchments)
    sec_features = []
    seen = set()
    for fname in ["QLD-junior_secondary_catchments_2026.kml", "QLD-senior_secondary_catchments_2026.kml"]:
        fpath = os.path.join(qld_dir, fname)
        if os.path.exists(fpath):
            kml_feats = parse_kml_file(fpath)
            for name, geom in kml_feats:
                key = (name.lower().strip(), geom.centroid.x, geom.centroid.y)
                if key not in seen:
                    seen.add(key)
                    sec_features.append(build_feature(name, "Secondary", "QLD", geom))
    save_geojson(sec_features, "qld_secondary.json")

# -----------------------------------------------------------------------------
# SA
# -----------------------------------------------------------------------------
def process_sa():
    print("--- Processing SA ---")
    sa_dir = "/Users/andrewpham/Documents/GitHub/au-rea-insights/source_files/SA"
    
    # Primary
    prim_path = os.path.join(sa_dir, "SA-primaryschoolzones2025ey", "PrimarySchoolZones2025EY.shp")
    if os.path.exists(prim_path):
        sf = shapefile.Reader(prim_path)
        fields = [f[0] for f in sf.fields[1:]]
        features = []
        for sr in sf.shapeRecords():
            record = dict(zip(fields, sr.record))
            name = record.get('school', 'Unknown')
            geom = shape(sr.shape.__geo_interface__)
            features.append(build_feature(name, "Primary", "SA", geom))
        save_geojson(features, "sa_primary.json")
        
    # Secondary
    sec_path = os.path.join(sa_dir, "SA-highschoolzones2025ey", "HighSchoolZones2025EY.shp")
    if os.path.exists(sec_path):
        sf = shapefile.Reader(sec_path)
        fields = [f[0] for f in sf.fields[1:]]
        features = []
        for sr in sf.shapeRecords():
            record = dict(zip(fields, sr.record))
            name = record.get('school', 'Unknown')
            geom = shape(sr.shape.__geo_interface__)
            features.append(build_feature(name, "Secondary", "SA", geom))
        save_geojson(features, "sa_secondary.json")

# -----------------------------------------------------------------------------
# TAS
# -----------------------------------------------------------------------------
def process_tas():
    print("--- Processing TAS ---")
    tas_path = "/Users/andrewpham/Documents/GitHub/au-rea-insights/source_files/TAS/TAS-LIST_DOE_SCHOOL_INTAKE_AREAS_STATEWIDE/list_doe_school_intake_areas_statewide.shp"
    
    if os.path.exists(tas_path):
        sf = shapefile.Reader(tas_path)
        fields = [f[0] for f in sf.fields[1:]]
        
        primary_features = []
        secondary_features = []
        
        for sr in sf.shapeRecords():
            record = dict(zip(fields, sr.record))
            name = record.get('SCHOOL_NAM', 'Unknown')
            sec = record.get('SCHOOL_SEC', 'Primary')
            geom = shape(sr.shape.__geo_interface__)
            
            # Reproject from MGA Zone 55 (EPSG:28355) to WGS84 (EPSG:4326)
            try:
                reprojected_geom = transform(tas_transformer.transform, geom)
            except Exception as e:
                print(f"Failed to reproject TAS school {name}: {e}")
                continue
            
            # Split / classify
            # If Primary, it is primary. If Combined, it's both primary and secondary.
            if sec.lower() == 'primary' or sec.lower() == 'combined':
                primary_features.append(build_feature(name, "Primary", "TAS", reprojected_geom))
            if sec.lower() == 'combined':
                secondary_features.append(build_feature(name, "Secondary", "TAS", reprojected_geom))
                
        save_geojson(primary_features, "tas_primary.json")
        save_geojson(secondary_features, "tas_secondary.json")

# -----------------------------------------------------------------------------
# ACT
# -----------------------------------------------------------------------------
def process_act():
    print("--- Processing ACT ---")
    act_dir = "/Users/andrewpham/Documents/GitHub/au-rea-insights/source_files/ACT"
    
    # Primary
    prim_csv = os.path.join(act_dir, "ACT-Education_Primary_School_Priority_Enrolment_Areas_2018_20260612.csv")
    if os.path.exists(prim_csv):
        features = []
        with open(prim_csv, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row.get('NAME', 'Unknown')
                wkt_str = row.get('the_geom', '')
                if wkt_str:
                    try:
                        geom = shapely.wkt.loads(wkt_str)
                        features.append(build_feature(name, "Primary", "ACT", geom))
                    except Exception as e:
                        print(f"Error loading WKT for ACT {name}: {e}")
        save_geojson(features, "act_primary.json")
        
    # Secondary
    sec_csv = os.path.join(act_dir, "ACT-Education_Highschool_Priority_Enrolment_Areas_2018_20260612.csv")
    if os.path.exists(sec_csv):
        features = []
        with open(sec_csv, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row.get('NAME', 'Unknown')
                wkt_str = row.get('the_geom', '')
                if wkt_str:
                    try:
                        geom = shapely.wkt.loads(wkt_str)
                        features.append(build_feature(name, "Secondary", "ACT", geom))
                    except Exception as e:
                        print(f"Error loading WKT for ACT {name}: {e}")
        save_geojson(features, "act_secondary.json")

# -----------------------------------------------------------------------------
# WA
# -----------------------------------------------------------------------------
def process_wa():
    print("--- Processing WA ---")
    wa_xlsx = "/Users/andrewpham/Documents/GitHub/au-rea-insights/source_files/WA/WA-currentactiveschools20261.xlsx"
    
    if os.path.exists(wa_xlsx):
        df = pd.read_excel(wa_xlsx)
        primary_features = []
        secondary_features = []
        
        for _, row in df.iterrows():
            name = str(row.get('SchoolName', '')).strip()
            lat = row.get('Latitude')
            lng = row.get('Longitude')
            if pd.isna(lat) or pd.isna(lng) or not name:
                continue
            
            lat = float(lat)
            lng = float(lng)
            geom = Point(lng, lat)
            
            low_year = str(row.get('LowYear', '')).upper().strip()
            high_year = str(row.get('HighYear', '')).upper().strip()
            tot_prim = row.get('TotalPrimaryK_6', 0)
            tot_sec = row.get('TotalSecondary7_12', 0)
            
            # Classification logic
            is_primary = False
            is_secondary = False
            
            name_lower = name.lower()
            if 'primary' in name_lower or 'ps' in name_lower:
                is_primary = True
            if 'high' in name_lower or 'senior' in name_lower or 'secondary' in name_lower or 'shs' in name_lower:
                is_secondary = True
            
            # Check totals and year levels
            if not pd.isna(tot_prim) and float(tot_prim) > 0:
                is_primary = True
            if not pd.isna(tot_sec) and float(tot_sec) > 0:
                is_secondary = True
                
            # Default fallbacks based on LowYear/HighYear ranges
            if low_year in ['PKG', 'KIN', 'P', 'K', 'Y01', 'Y1', 'Y02', 'Y2', 'Y03', 'Y3', 'Y04', 'Y4', 'Y05', 'Y5', 'Y06', 'Y6']:
                is_primary = True
            if high_year in ['Y07', 'Y7', 'Y08', 'Y8', 'Y09', 'Y9', 'Y10', 'Y11', 'Y12', 'Y13']:
                is_secondary = True
                
            # If still undetermined, put in both
            if not is_primary and not is_secondary:
                is_primary = True
                is_secondary = True
                
            feature = {
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": {
                    "schoolName": name,
                    "type": "Primary" if is_primary else "Secondary",
                    "state": "WA",
                    "centroid": [lng, lat]
                }
            }
            
            if is_primary:
                primary_features.append(feature)
            if is_secondary:
                # Need to update type property for secondary file
                feature_sec = json.loads(json.dumps(feature))
                feature_sec['properties']['type'] = 'Secondary'
                secondary_features.append(feature_sec)
                
        save_geojson(primary_features, "wa_primary.json")
        save_geojson(secondary_features, "wa_secondary.json")

# -----------------------------------------------------------------------------
# NT
# -----------------------------------------------------------------------------
def process_nt():
    print("--- Processing NT ---")
    nt_dir = "/Users/andrewpham/Documents/GitHub/au-rea-insights/source_files/NT"
    
    # 1. Primary
    primary_txt = os.path.join(nt_dir, "NT-PrimarySchool.txt")
    if os.path.exists(primary_txt):
        content = open(primary_txt, 'r', encoding='utf-8').read()
        mids = re.findall(r'mid=([a-zA-Z0-9_-]+)', content)
        features = []
        for mid in set(mids):
            print(f"Downloading KML for NT Primary My Maps mid: {mid}")
            with tempfile.NamedTemporaryFile(suffix=".kml", delete=False) as temp_file:
                temp_path = temp_file.name
            try:
                url = f"https://www.google.com/maps/d/kml?mid={mid}&forcekml=1"
                req = urllib.request.Request(
                    url, 
                    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
                )
                with urllib.request.urlopen(req) as response:
                    with open(temp_path, 'wb') as f:
                        f.write(response.read())
                
                kml_feats = parse_kml_file(temp_path)
                for name, geom in kml_feats:
                    features.append(build_feature(name, "Primary", "NT", geom))
            except Exception as e:
                print(f"Failed to fetch/parse NT map {mid}: {e}")
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
        save_geojson(features, "nt_primary.json")
        
    # 2. Secondary
    secondary_txt = os.path.join(nt_dir, "NT-SecondarySchools.txt")
    if os.path.exists(secondary_txt):
        content = open(secondary_txt, 'r', encoding='utf-8').read()
        mids = re.findall(r'mid=([a-zA-Z0-9_-]+)', content)
        features = []
        for mid in set(mids):
            print(f"Downloading KML for NT Secondary My Maps mid: {mid}")
            with tempfile.NamedTemporaryFile(suffix=".kml", delete=False) as temp_file:
                temp_path = temp_file.name
            try:
                url = f"https://www.google.com/maps/d/kml?mid={mid}&forcekml=1"
                req = urllib.request.Request(
                    url, 
                    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
                )
                with urllib.request.urlopen(req) as response:
                    with open(temp_path, 'wb') as f:
                        f.write(response.read())
                
                kml_feats = parse_kml_file(temp_path)
                for name, geom in kml_feats:
                    features.append(build_feature(name, "Secondary", "NT", geom))
            except Exception as e:
                print(f"Failed to fetch/parse NT map {mid}: {e}")
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
        save_geojson(features, "nt_secondary.json")

# -----------------------------------------------------------------------------
# Main Execution
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    try:
        process_vic()
        process_nsw()
        process_qld()
        process_sa()
        process_tas()
        process_act()
        process_wa()
        process_nt()
        print("=== Unified school zone data processing successfully completed! ===")
    except Exception as e:
        print(f"Execution failed: {e}", file=sys.stderr)
        sys.exit(1)
