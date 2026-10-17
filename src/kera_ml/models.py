"""Small CPU MLP, with inner validation for epoch selection only."""
import copy
import numpy as np
import torch
from torch import nn
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import GroupShuffleSplit

def network(widths=(32,16),dropout=0.):
    layers=[];n=42
    for width in widths:
        layers.extend([nn.Linear(n,width),nn.ReLU()])
        if dropout:layers.append(nn.Dropout(dropout))
        n=width
    return nn.Sequential(*layers,nn.Linear(n,1))

def setup(seed):
    torch.set_num_threads(1);torch.manual_seed(seed);torch.use_deterministic_algorithms(True)

def fit_mlp(X,y,config,seed,epochs,validation=None):
    setup(seed)
    scaler=StandardScaler().fit(X);mu=float(y.mean());sigma=max(float(y.std()),1.)
    tx=torch.tensor(scaler.transform(X),dtype=torch.float32)
    ty=torch.tensor((y-mu)/sigma,dtype=torch.float32).reshape(-1,1)
    net=network(config['widths'],config['dropout'])
    opt=torch.optim.AdamW(net.parameters(),lr=config['lr'],weight_decay=config['weight_decay'])
    loss_fn=nn.SmoothL1Loss() if config['loss']=='huber' else nn.MSELoss()
    gen=torch.Generator().manual_seed(seed)
    history=[];best=float('inf');best_epoch=1;best_state=None;stale=0
    if validation is not None:
        vx,vy=validation;vx=torch.tensor(scaler.transform(vx),dtype=torch.float32)
    for epoch in range(epochs):
        net.train()
        for idx in torch.randperm(len(X),generator=gen).split(16):
            opt.zero_grad();loss=loss_fn(net(tx[idx]),ty[idx]);loss.backward();opt.step()
        net.eval()
        with torch.no_grad():
            train_rmse=float(torch.sqrt(torch.mean((net(tx).ravel()*sigma+mu-torch.tensor(y))**2)))
            val_rmse=float(np.sqrt(np.mean((net(vx).numpy().ravel()*sigma+mu-vy)**2))) if validation is not None else None
        history.append(dict(epoch=epoch+1,train_rmse=train_rmse,validation_rmse=val_rmse))
        if val_rmse is not None:
            if val_rmse < best-1e-4:
                best=val_rmse;best_epoch=epoch+1;best_state=copy.deepcopy(net.state_dict());stale=0
            else:stale+=1
            if stale>=25:break
    if validation is not None:net.load_state_dict(best_state)
    else:best_epoch=epochs
    bundle=dict(state_dict=net.state_dict(),config=config,seed=seed,epochs=best_epoch,
                feature_mean=scaler.mean_.tolist(),feature_scale=scaler.scale_.tolist(),target_mean=mu,target_scale=sigma)
    return bundle,history

def predict_mlp(bundle,X):
    setup(bundle['seed']);net=network(bundle['config']['widths'],bundle['config']['dropout'])
    net.load_state_dict(bundle['state_dict']);net.eval()
    x=(np.asarray(X)-bundle['feature_mean'])/bundle['feature_scale']
    with torch.no_grad():return net(torch.tensor(x,dtype=torch.float32)).numpy().ravel()*bundle['target_scale']+bundle['target_mean']

def choose_epochs(X,y,groups,config,seed,max_epochs=200):
    tr,va=next(GroupShuffleSplit(n_splits=1,test_size=.2,random_state=seed).split(X,y,groups))
    assert not set(groups[tr])&set(groups[va])
    bundle,history=fit_mlp(X[tr],y[tr],config,seed,max_epochs,(X[va],y[va]))
    return bundle['epochs'],history
