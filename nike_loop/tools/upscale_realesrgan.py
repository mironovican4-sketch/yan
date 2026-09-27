"""Real-ESRGAN x4plus upscaler without PyTorch: loads the official .pth, builds an ONNX graph, runs it on CPU.

Usage: python3 upscale_realesrgan.py RealESRGAN_x4plus.pth input.jpg output.png
Weights: https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth
Needs: numpy, onnx, onnxruntime, pillow
"""
import zipfile, pickle, numpy as np, sys, collections
import onnx
from onnx import helper, TensorProto, numpy_helper
import onnxruntime as ort
from PIL import Image

# ---- minimal torch zip-pickle loader (no torch needed) ----
z = zipfile.ZipFile(sys.argv[1])
prefix = z.namelist()[0].split("/")[0]
DT = {"FloatStorage": np.float32, "HalfStorage": np.float16, "LongStorage": np.int64}
class StorageType:
    def __init__(s, name): s.name = name
def rebuild_tensor_v2(storage, offset, size, stride, *args):
    return np.lib.stride_tricks.as_strided(storage[offset:], shape=size, strides=[s * storage.itemsize for s in stride]).copy()
class U(pickle.Unpickler):
    def find_class(s, mod, name):
        if name == "_rebuild_tensor_v2": return rebuild_tensor_v2
        if name.endswith("Storage"): return StorageType(name)
        if mod == "collections" and name == "OrderedDict": return collections.OrderedDict
        return super().find_class(mod, name)
    def persistent_load(s, pid):
        _, st, key, loc, numel = pid
        raw = z.read(f"{prefix}/data/{key}")
        return np.frombuffer(raw, dtype=DT[st.name])
sd = U(z.open(f"{prefix}/data.pkl")).load()
sd = sd.get("params_ema", sd)
print("tensors", len(sd))

# ---- build ONNX graph for RRDBNet x4 ----
inits = []; nodes = []; cnt = [0]
def uid(p): cnt[0] += 1; return f"{p}_{cnt[0]}"
def conv(x, name):
    w = sd[name + ".weight"].astype(np.float32); b = sd[name + ".bias"].astype(np.float32)
    inits.append(numpy_helper.from_array(w, name + ".weight")); inits.append(numpy_helper.from_array(b, name + ".bias"))
    y = uid("conv"); nodes.append(helper.make_node("Conv", [x, name + ".weight", name + ".bias"], [y], pads=[1,1,1,1], kernel_shape=[3,3])); return y
def lrelu(x): y = uid("lr"); nodes.append(helper.make_node("LeakyRelu", [x], [y], alpha=0.2)); return y
def cat(xs): y = uid("cat"); nodes.append(helper.make_node("Concat", xs, [y], axis=1)); return y
def add(a, b): y = uid("add"); nodes.append(helper.make_node("Add", [a, b], [y])); return y
inits.append(numpy_helper.from_array(np.array(0.2, np.float32), "k02"))
def mul02(x): y = uid("mul"); nodes.append(helper.make_node("Mul", [x, "k02"], [y])); return y
inits.append(numpy_helper.from_array(np.array([1,1,2,2], np.float32), "scales2"))
def up2(x): y = uid("up"); nodes.append(helper.make_node("Resize", [x, "", "scales2"], [y], mode="nearest")); return y
def rdb(x, p):
    x1 = lrelu(conv(x, p+".conv1")); x2 = lrelu(conv(cat([x,x1]), p+".conv2")); x3 = lrelu(conv(cat([x,x1,x2]), p+".conv3"))
    x4 = lrelu(conv(cat([x,x1,x2,x3]), p+".conv4")); x5 = conv(cat([x,x1,x2,x3,x4]), p+".conv5")
    return add(mul02(x5), x)
f = conv("input", "conv_first"); b = f
for i in range(23):
    h = rdb(rdb(rdb(b, f"body.{i}.rdb1"), f"body.{i}.rdb2"), f"body.{i}.rdb3"); b = add(mul02(h), b)
f = add(f, conv(b, "conv_body"))
f = lrelu(conv(up2(f), "conv_up1")); f = lrelu(conv(up2(f), "conv_up2"))
out = conv(lrelu(conv(f, "conv_hr")), "conv_last")
nodes.append(helper.make_node("Identity", [out], ["output"]))
g = helper.make_graph(nodes, "rrdb", [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1,3,None,None])],
                      [helper.make_tensor_value_info("output", TensorProto.FLOAT, [1,3,None,None])], inits)
model = helper.make_model(g, opset_imports=[helper.make_opsetid("", 17)]); model.ir_version = 8
onnx_path = "realesrgan_x4.onnx"
onnx.save(model, onnx_path)
sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
src, dst = sys.argv[2], sys.argv[3]
im = np.array(Image.open(src).convert("RGB")).astype(np.float32) / 255.
y = sess.run(None, {"input": im.transpose(2,0,1)[None]})[0][0]
Image.fromarray((np.clip(y.transpose(1,2,0), 0, 1) * 255 + 0.5).astype(np.uint8)).save(dst)
print("ok", y.shape)
