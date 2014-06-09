time:
	time rdfind /home/m/Downloads/
	time duff -rP /home/m/Downloads/ > duff.txt
	time /usr/share/fslint/fslint/findup /home/m/Downloads > fslint.txt
	time node bin/findup --include /home/m/Downloads/ --list > report.txt

.PHONY: time
