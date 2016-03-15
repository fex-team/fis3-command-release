# fiss-command-release
fis-command-release的修改版，减轻命令行输入的负担，使得命令行的参数都可以在fis-conf.js里面可配置。如果命令行输入了参数，
则使用命令行传入的参数，如果没有，读取fis-conf.js里面的设置的参数。

##fis-conf.js配置方法
```js
//发布路径设置
fis.media('debug')
	.set('release',{
	    'dir':'output',//release的dest路径，对应命令行的-d/--dest参数
	    /*'watch':true,//对应命令行的-w参数
	    'live':true,*/ //对应命令行的-L参数
	    'clean':false, //对应命令行的-c参数
	    /*'lint':true,*///对应命令行的-l参数
	    'clear':true //每次release之前是否先清空dest目录
	});


```

使用方法
```bash
#后面不需要带-d -w -L -l -c 等参数
fiss release prod

```

---
# 下面为原版fis-command-release的reademe内容
## Usage

     Usage: fis release [media name]

     Options:

       -d, --dest <names>     release output destination
       -w, --watch            monitor the changes of project
       -L, --live             automatically reload your browser
       -c, --clean            clean compile cache
       -u, --unique           use unique compile caching
