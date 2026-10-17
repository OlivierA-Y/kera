import json
import numpy as np
import pytest
from PIL import Image
from kera_ml.preprocessing import parse_boxes, load_rgb, crop, central_crop, regions
from kera_ml.features import extract, FEATURE_NAMES

@pytest.fixture
def image():
    a=np.full((30,40,3),[200,100,50],dtype=np.uint8)
    a[0:10,0:10]=[100,25,10]
    a[10:20,10:20]=[40,60,20]
    return a

def test_boxes():
    assert parse_boxes('[[1,2,3,4],[5,6,7,8],[9,10,11,12]]')[1].tolist()==[5,6,7,8]

@pytest.mark.parametrize('value',['__import__("os").system("false")','[[1,2,3,4]]', '[[1.2,2,3,4],[1,2,3,4],[1,2,3,4]]'])
def test_bad_boxes(value):
    with pytest.raises(ValueError):parse_boxes(value)

def test_coordinates():
    a=np.arange(8*10*3).reshape(8,10,3)
    np.testing.assert_array_equal(crop(a,[1,3,4,7]),a[1:4,3:7])

def test_middle_finger(image):
    boxes=parse_boxes([[20,20,30,30],[0,0,10,10],[10,10,20,20]])
    f,_=extract(image,boxes[1],[10,10,20,20],[20,20,30,30])
    np.testing.assert_allclose(f[:7],.5)

def test_central_geometry():
    a=np.zeros((11,17,3));assert central_crop(a).shape==(6,10,3)
    np.testing.assert_array_equal(central_crop(a),a[2:8,3:13])

def test_rgb_percentile_order_normalization(image,tmp_path):
    p=tmp_path/'rgb.png';Image.fromarray(image).save(p)
    np.testing.assert_array_equal(load_rgb(p),image)
    f,w=extract(p,[0,0,10,10],[10,10,20,20],[20,20,30,30])
    expected=np.repeat([.5,.25,.2,.2,.6,.4],7)
    np.testing.assert_allclose(f,expected)
    assert f.shape==(42,) and FEATURE_NAMES[0]=='NAIL_R_p=5' and FEATURE_NAMES[-1]=='SKIN_B_p=95'

def test_percentiles():
    a=np.full((20,20,3),100,dtype=np.uint8)
    a[:10,:10]=np.arange(100).reshape(10,10,1)
    f,_=extract(a,[0,0,10,10],[10,10,20,20],[10,0,20,10])
    expected=np.percentile(a[2:8,2:8,0],[5,15,25,50,75,85,95])/100
    np.testing.assert_allclose(f[:7],expected)

@pytest.mark.parametrize('box',[[1,1,1,2],[-1,0,2,2],[0,0,31,2],[0.,0,2,2]])
def test_invalid_crop(image,box):
    with pytest.raises(ValueError):extract(image,box,[10,10,20,20],[20,20,30,30])

def test_missing_image():
    with pytest.raises(FileNotFoundError):load_rgb('/nonexistent/kera.jpg')

@pytest.mark.parametrize('value',[np.nan,np.inf,-1,256])
def test_nonfinite(value):
    a=np.ones((10,10,3));a[0,0,0]=value
    with pytest.raises(ValueError):load_rgb(a)

def test_bad_reference(image):
    image[20:30,20:30]=0
    with pytest.raises(ValueError):extract(image,[0,0,10,10],[10,10,20,20],[20,20,30,30])

def test_degenerate_central():
    with pytest.raises(ValueError):central_crop(np.ones((1,1,3)))

def test_channelwise_median(image):
    image[20:30,20:30]=[200,100,50];image[20,20]=255
    _,_,ref,_=regions(image,[0,0,10,10],[10,10,20,20],[20,20,30,30])
    np.testing.assert_array_equal(ref,[200,100,50])
