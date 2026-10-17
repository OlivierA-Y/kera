import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score, median_absolute_error
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

def metrics(y, p):
    y, p = np.asarray(y), np.asarray(p)
    if y.shape != p.shape or not np.isfinite(y).all() or not np.isfinite(p).all():
        raise ValueError('Predictions and labels must be matched finite arrays')
    return dict(n=len(y), mae=float(mean_absolute_error(y,p)), rmse=float(np.sqrt(mean_squared_error(y,p))),
                r2=float(r2_score(y,p)) if len(y)>1 else None, bias=float(np.mean(p-y)),
                median_absolute_error=float(median_absolute_error(y,p)))

def diagnostics(y, p, path, title):
    y,p = np.asarray(y),np.asarray(p); e=p-y
    fig,ax=plt.subplots(2,2,figsize=(10,8))
    ax[0,0].scatter(y,p,s=16); lim=[min(y.min(),p.min())-5,max(y.max(),p.max())+5]
    ax[0,0].plot(lim,lim,'k--'); ax[0,0].set(xlabel='Measured Hb (g/L)',ylabel='Predicted Hb (g/L)')
    ax[0,1].hist(e,bins=15);ax[0,1].set(xlabel='Prediction − measured (g/L)',ylabel='Count')
    ax[1,0].scatter(y,e,s=16);ax[1,0].axhline(0,color='k');ax[1,0].set(xlabel='Measured Hb (g/L)',ylabel='Residual (g/L)')
    ax[1,1].scatter((y+p)/2,e,s=16)
    for val in [e.mean(),e.mean()-1.96*e.std(ddof=1),e.mean()+1.96*e.std(ddof=1)]:ax[1,1].axhline(val,linestyle='--',color='k')
    ax[1,1].set(xlabel='Mean of predicted and measured Hb (g/L)',ylabel='Difference (g/L)',title='Bland–Altman')
    fig.suptitle(title);fig.tight_layout();fig.savefig(path,dpi=150);plt.close(fig)
