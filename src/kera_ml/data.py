"""Official data download, audit and deterministic feature cache."""
import argparse, hashlib, json, urllib.request, zipfile
from pathlib import Path
import numpy as np
import pandas as pd
from PIL import Image
from .preprocessing import load_rgb, parse_boxes, crop, regions, REFERENCE
from .features import extract, FEATURE_NAMES, FEATURE_VERSION

ARTICLE = 'https://api.figshare.com/v2/articles/25867432'

def download(root):
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    meta=json.load(urllib.request.urlopen(ARTICLE))
    (root/'figshare.json').write_text(json.dumps(meta,indent=2))
    item=next(x for x in meta['files'] if x['id']==49504041)
    if item['computed_md5']!='7bd86daf16c69e370173d9a7a92474b0':raise ValueError('Unexpected official dataset version')
    archive=root/'data.zip'
    if not archive.exists():urllib.request.urlretrieve(item['download_url'],archive)
    if hashlib.md5(archive.read_bytes()).hexdigest()!=item['computed_md5']:raise ValueError('Dataset checksum mismatch')
    raw=root/'raw';raw.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        for member in z.infolist():
            if not (raw/member.filename).resolve().is_relative_to(raw.resolve()):raise ValueError('Unsafe zip path')
        z.extractall(raw)

def prepare(root, out, report):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    root,out,report=Path(root),Path(out),Path(report)
    out.parent.mkdir(parents=True,exist_ok=True);report.mkdir(parents=True,exist_ok=True)
    metadata=list(root.rglob('metadata.csv'))
    if len(metadata)!=1:raise ValueError('Expected exactly one metadata.csv')
    df=pd.read_csv(metadata[0]); base=metadata[0].parent
    rows=[];errors=[];hashes={}; dhashes=[]; thumbnails=[]; dims=[]; examples=[]
    for row in df.itertuples():
        try:
            pid=int(row.PATIENT_ID)
            if not np.isfinite(row.HB_LEVEL_GperL):raise ValueError('Missing or nonfinite Hb')
            paths=list(base.rglob(f'{pid}.jpg'))
            if len(paths)!=1:raise FileNotFoundError(f'Expected one image for {pid}, found {len(paths)}')
            path=paths[0];im=load_rgb(path)
            nb,sb=parse_boxes(row.NAIL_BOUNDING_BOXES),parse_boxes(row.SKIN_BOUNDING_BOXES)
            for b in list(nb)+list(sb):crop(im,b)
            f,warnings=extract(im,nb[1],sb[1])
            n,s,white,_=regions(im,nb[1],sb[1])
            dims.append(dict(patient_id=pid,image=list(im.shape),nail=list(n.shape),skin=list(s.shape)))
            digest=hashlib.sha256(im.tobytes()).hexdigest();hashes.setdefault(digest,[]).append(pid)
            thumb=np.asarray(Image.fromarray(im).convert('L').resize((9,8)))
            dhashes.append((pid,(thumb[:,1:]>thumb[:,:-1]).ravel()))
            thumbnails.append(np.asarray(Image.fromarray(im).resize((64,64)),dtype=np.float32))
            rows.append(dict(patient_id=pid,hb=float(row.HB_LEVEL_GperL),image_path=str(path.resolve()),
                             image_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),warnings='; '.join(warnings),**dict(zip(FEATURE_NAMES,f))))
            if len(examples)<6:examples.append((pid,n,s,white))
        except (ValueError,OSError) as e:errors.append(dict(patient_id=str(row.PATIENT_ID),error=str(e)))
    table=pd.DataFrame(rows)
    if len(table)==0:raise ValueError(f'No valid images: {errors}')
    near=[]
    for i,(pid,h) in enumerate(dhashes):
        for j,(other,k) in enumerate(dhashes[:i]):
            distance=int(np.count_nonzero(h!=k))
            rmse=float(np.sqrt(np.mean((thumbnails[i]-thumbnails[j])**2)))
            if rmse<5:near.append(dict(patient_ids=[pid,other],dhash_distance=distance,rgb_thumbnail_rmse=rmse))
    audit=dict(metadata_rows=len(df),unique_patients=int(df.PATIENT_ID.nunique()),images=len(list(base.rglob('*.jpg'))),
               loaded=len(table),missing_labels=int(df.HB_LEVEL_GperL.isna().sum()),duplicate_patient_ids=df.loc[df.PATIENT_ID.duplicated(False),'PATIENT_ID'].tolist(),
               errors=errors,exact_duplicate_images=[v for v in hashes.values() if len(v)>1],near_duplicate_candidates=near,
               hb_summary=table.hb.describe().to_dict(),dimensions=dims,feature_version=FEATURE_VERSION,
               metadata_sha256=hashlib.sha256(metadata[0].read_bytes()).hexdigest())
    (report/'data_audit.json').write_text(json.dumps(audit,indent=2))
    if errors or audit['duplicate_patient_ids'] or audit['exact_duplicate_images']:
        raise ValueError('Audit requires review before splitting; see data_audit.json')
    # Connected components of near-duplicate images remain together in every split.
    groups={int(pid):int(pid) for pid in table.patient_id}
    for pair in near:
        a,b=pair['patient_ids']; ga,gb=groups[a],groups[b]
        groups={pid:min(ga,gb) if g in (ga,gb) else g for pid,g in groups.items()}
    table['group_id']=table.patient_id.map(groups)
    audit['unlabelled_images']=sorted(set(p.stem for p in base.rglob('*.jpg'))-set(table.patient_id.astype(str)))
    (report/'data_audit.json').write_text(json.dumps(audit,indent=2))
    table.to_csv(out,index=False)
    fig,axes=plt.subplots(len(examples),4,figsize=(9,2*len(examples)))
    for ax,(pid,n,s,white) in zip(axes,examples):
        for a,arr,label in zip(ax,[n,s,n/white,s/white],['Raw nail','Raw skin','Normalized nail','Normalized skin']):
            a.imshow(np.clip(arr,0,1) if 'Normalized' in label else arr);a.set_title(f'{pid}: {label}',fontsize=8);a.axis('off')
    fig.tight_layout();fig.savefig(report/'crops.png',dpi=150);plt.close(fig)
    # Audit-only distribution, never used for tuning/split stratification.
    plt.hist(table.hb,bins=20);plt.xlabel('Measured Hb (g/L)');plt.ylabel('Patients')
    plt.savefig(report/'hb_distribution.png',dpi=150);plt.close()
    print(json.dumps({k:v for k,v in audit.items() if k not in ('dimensions',)},indent=2))

def main():
    p=argparse.ArgumentParser();p.add_argument('command',choices=['download','prepare','validate'])
    p.add_argument('--root',default='data');p.add_argument('--out',default='data/features.csv');p.add_argument('--reports',default='reports')
    a=p.parse_args()
    if a.command=='download':download(a.root)
    else:prepare(a.root,a.out,a.reports)
if __name__=='__main__':main()
